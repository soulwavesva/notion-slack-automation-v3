import { Client } from '@notionhq/client';
import { WebClient } from '@slack/web-api';

export default async function handler(req, res) {
  try {
    console.log('🔄 Starting Notion-Slack sync...');
    
    // Initialize clients
    const notion = new Client({ auth: process.env.NOTION_API_KEY });
    const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
    
    // Clear existing messages first
    await clearSlackChannel(slack);
    
    // Get today's date for filtering
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // Get 7 days from now for upcoming tasks
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(today.getDate() + 7);
    const sevenDaysStr = sevenDaysFromNow.toISOString().split('T')[0];
    
    // Fetch overdue and due today tasks (priority)
    const overdueResponse = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID,
      filter: {
        and: [
          {
            property: 'Checkbox',
            checkbox: { equals: false }
          },
          {
            property: 'Due Date',
            date: { before: todayStr }
          }
        ]
      },
      sorts: [{ property: 'Due Date', direction: 'ascending' }]
    });
    
    // Fetch due today tasks
    const dueTodayResponse = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID,
      filter: {
        and: [
          {
            property: 'Checkbox',
            checkbox: { equals: false }
          },
          {
            property: 'Due Date',
            date: { equals: todayStr }
          }
        ]
      },
      sorts: [{ property: 'Due Date', direction: 'ascending' }]
    });
    
    // Fetch upcoming tasks (next 7 days) to fill remaining slots
    const upcomingResponse = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID,
      filter: {
        and: [
          {
            property: 'Checkbox',
            checkbox: { equals: false }
          },
          {
            property: 'Due Date',
            date: { 
              after: todayStr,
              on_or_before: sevenDaysStr
            }
          }
        ]
      },
      sorts: [{ property: 'Due Date', direction: 'ascending' }]
    });
    
    // Combine all tasks: overdue first, then due today, then upcoming
    const allTasks = [
      ...overdueResponse.results,
      ...dueTodayResponse.results,
      ...upcomingResponse.results
    ];
    
    console.log(`Found ${overdueResponse.results.length} overdue, ${dueTodayResponse.results.length} due today, ${upcomingResponse.results.length} upcoming tasks`);
    
    // Process tasks and organize by person
    const tasksByPerson = { ROB: [], SAM: [], ANNA: [], UNASSIGNED: [] };
    
    for (const page of allTasks) {
      const task = {
        id: page.id,
        title: extractTitle(page),
        dueDate: extractDueDate(page),
        url: page.url,
        assignedTo: extractAssignedPerson(page),
        isOverdue: page.properties['Due Date']?.date?.start < todayStr,
        isDueToday: page.properties['Due Date']?.date?.start === todayStr,
        isUpcoming: page.properties['Due Date']?.date?.start > todayStr
      };
      
      const personKey = task.assignedTo?.key || 'UNASSIGNED';
      if (tasksByPerson[personKey]) {
        tasksByPerson[personKey].push(task);
      } else {
        tasksByPerson['UNASSIGNED'].push(task);
      }
    }
    
    // Sort tasks within each person: overdue first, then due today, then upcoming
    for (const [person, tasks] of Object.entries(tasksByPerson)) {
      tasks.sort((a, b) => {
        // Overdue tasks first
        if (a.isOverdue && !b.isOverdue) return -1;
        if (!a.isOverdue && b.isOverdue) return 1;
        
        // Then due today tasks
        if (a.isDueToday && !b.isDueToday) return -1;
        if (!a.isDueToday && b.isDueToday) return 1;
        
        // Then by due date
        return new Date(a.dueDate) - new Date(b.dueDate);
      });
    }
    
    // Post up to 3 tasks per person (9 total), filling with upcoming tasks if needed
    const postedTasks = [];
    for (const [person, tasks] of Object.entries(tasksByPerson)) {
      if (tasks.length === 0) continue;
      
      const tasksToPost = tasks.slice(0, 3); // Take up to 3 tasks per person
      
      for (const task of tasksToPost) {
        try {
          await postTaskToSlack(slack, task);
          postedTasks.push({ 
            person, 
            title: task.title, 
            isOverdue: task.isOverdue,
            isDueToday: task.isDueToday,
            isUpcoming: task.isUpcoming
          });
          
          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`Failed to post task: ${task.title}`, error);
        }
      }
    }
    
    console.log(`✅ Posted ${postedTasks.length} tasks to Slack`);
    
    res.status(200).json({
      success: true,
      message: 'Sync completed successfully',
      tasksPosted: postedTasks.length,
      tasksByPerson: {
        ROB: postedTasks.filter(t => t.person === 'ROB').length,
        SAM: postedTasks.filter(t => t.person === 'SAM').length,
        ANNA: postedTasks.filter(t => t.person === 'ANNA').length,
        UNASSIGNED: postedTasks.filter(t => t.person === 'UNASSIGNED').length
      },
      overdueTasks: postedTasks.filter(t => t.isOverdue).length,
      dueTodayTasks: postedTasks.filter(t => t.isDueToday).length,
      upcomingTasks: postedTasks.filter(t => t.isUpcoming).length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Sync error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
}

async function clearSlackChannel(slack) {
  try {
    console.log('🧹 Clearing existing Slack messages...');
    
    // Get recent messages from the channel
    const history = await slack.conversations.history({
      channel: process.env.SLACK_CHANNEL_ID,
      limit: 100
    });
    
    // Delete bot messages that contain task blocks
    for (const message of history.messages) {
      if (message.bot_id && message.blocks) {
        try {
          await slack.chat.delete({
            channel: process.env.SLACK_CHANNEL_ID,
            ts: message.ts
          });
          await new Promise(resolve => setTimeout(resolve, 50)); // Rate limit protection
        } catch (deleteError) {
          // Ignore delete errors (message might be too old)
          console.log('Could not delete message:', deleteError.message);
        }
      }
    }
    
    console.log('✅ Channel cleared');
  } catch (error) {
    console.error('Warning: Could not clear channel:', error.message);
  }
}

function extractTitle(page) {
  const titleProperty = Object.values(page.properties).find(prop => prop.type === 'title');
  return titleProperty?.title?.[0]?.plain_text || 'Untitled Task';
}

function extractDueDate(page) {
  return page.properties['Due Date']?.date?.start || null;
}

function extractAssignedPerson(page) {
  const assignedProperty = page.properties['Assigned To'];
  
  if (assignedProperty?.people?.[0]) {
    const personName = assignedProperty.people[0].name;
    
    // Exact matching for known people
    if (personName === 'Robert Schok') {
      return { key: 'ROB', name: 'ROB', emoji: '👨‍💼', fullName: 'Robert Schok' };
    } else if (personName === 'Samuel Robertson') {
      return { key: 'SAM', name: 'SAM', emoji: '👨‍💻', fullName: 'Samuel Robertson' };
    } else if (personName === 'Anna Schuster') {
      return { key: 'ANNA', name: 'ANNA', emoji: '👩‍💼', fullName: 'Anna Schuster' };
    }
    
    // Fallback for partial matches
    if (personName.includes('Robert') && personName.includes('Schok')) {
      return { key: 'ROB', name: 'ROB', emoji: '👨‍💼', fullName: personName };
    } else if (personName.includes('Samuel') && personName.includes('Robertson')) {
      return { key: 'SAM', name: 'SAM', emoji: '👨‍💻', fullName: personName };
    } else if (personName.includes('Anna') && personName.includes('Schuster')) {
      return { key: 'ANNA', name: 'ANNA', emoji: '👩‍💼', fullName: personName };
    }
    
    return { key: 'UNASSIGNED', name: personName.split(' ')[0].toUpperCase(), emoji: '👤', fullName: personName };
  }
  
  return { key: 'UNASSIGNED', name: 'UNASSIGNED', emoji: '❓', fullName: 'Unassigned' };
}

async function postTaskToSlack(slack, task) {
  const dueDate = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No due date';
  const today = new Date().toISOString().split('T')[0];
  
  let dueDateText = `📅 Due: ${dueDate}`;
  if (task.dueDate) {
    if (task.dueDate < today) {
      dueDateText = `🔴 *overdue*: ${dueDate}`;
    } else if (task.dueDate === today) {
      dueDateText = `🟡 *due today*: ${dueDate}`;
    } else {
      dueDateText = `📅 *upcoming*: ${dueDate}`;
    }
  }
  
  const assignedText = task.assignedTo ? `${task.assignedTo.emoji} *${task.assignedTo.name}*` : '❓ *UNASSIGNED*';
  
  await slack.chat.postMessage({
    channel: process.env.SLACK_CHANNEL_ID,
    text: `${task.assignedTo?.name || 'UNASSIGNED'}: ${task.title} - ${dueDate}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${assignedText} 📌 *${task.title}*\n${dueDateText}`
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Done' },
          style: 'primary',
          action_id: 'mark_done',
          value: task.id
        }
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `<${task.url}|View in Notion>` }]
      }
    ]
  });
  
  console.log(`📤 Posted task: "${task.title}" for ${task.assignedTo?.name || 'UNASSIGNED'}`);
}