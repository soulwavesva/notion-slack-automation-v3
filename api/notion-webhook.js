import { Client } from '@notionhq/client';
import { WebClient } from '@slack/web-api';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('📥 Notion webhook triggered');
    
    // Initialize clients
    const notion = new Client({ auth: process.env.NOTION_API_KEY });
    const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
    
    // Get today's date for filtering
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    // Check for new urgent tasks (overdue or due today)
    const urgentTasks = await getUrgentTasks(notion, todayStr);
    
    // Get current tasks in Slack to avoid duplicates
    const currentSlackTasks = await getCurrentSlackTasks(slack);
    
    // Find new tasks that aren't already posted
    const newTasks = urgentTasks.filter(task => 
      !currentSlackTasks.some(slackTask => slackTask.includes(task.id))
    );
    
    if (newTasks.length === 0) {
      console.log('✅ No new urgent tasks to post');
      return res.status(200).json({ 
        success: true, 
        message: 'No new urgent tasks found',
        timestamp: new Date().toISOString()
      });
    }
    
    // Organize by person and respect limits
    const tasksByPerson = organizeTasks(newTasks);
    const currentCounts = await getCurrentTaskCounts(slack);
    
    const postedTasks = [];
    
    for (const [person, tasks] of Object.entries(tasksByPerson)) {
      const currentCount = currentCounts[person] || 0;
      const availableSlots = Math.max(0, 3 - currentCount);
      
      if (availableSlots > 0) {
        const tasksToPost = tasks.slice(0, availableSlots);
        
        for (const task of tasksToPost) {
          try {
            await postTaskToSlack(slack, task);
            postedTasks.push({ person, title: task.title });
            
            // Small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (error) {
            console.error(`Failed to post task: ${task.title}`, error);
          }
        }
      }
    }
    
    console.log(`✅ Posted ${postedTasks.length} new urgent tasks`);
    
    res.status(200).json({
      success: true,
      message: 'Webhook processed successfully',
      newTasksPosted: postedTasks.length,
      tasks: postedTasks,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async function getUrgentTasks(notion, todayStr) {
  // Get overdue tasks
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
  
  // Get due today tasks
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
  
  // Combine and process tasks
  const allTasks = [...overdueResponse.results, ...dueTodayResponse.results];
  
  return allTasks.map(page => ({
    id: page.id,
    title: extractTitle(page),
    dueDate: extractDueDate(page),
    url: page.url,
    assignedTo: extractAssignedPerson(page),
    isOverdue: page.properties['Due Date']?.date?.start < todayStr
  }));
}

async function getCurrentSlackTasks(slack) {
  try {
    const history = await slack.conversations.history({
      channel: process.env.SLACK_CHANNEL_ID,
      limit: 50
    });
    
    return history.messages
      .filter(msg => msg.bot_id && msg.blocks)
      .map(msg => msg.text || '');
  } catch (error) {
    console.error('Error getting current Slack tasks:', error);
    return [];
  }
}

async function getCurrentTaskCounts(slack) {
  try {
    const history = await slack.conversations.history({
      channel: process.env.SLACK_CHANNEL_ID,
      limit: 50
    });
    
    const counts = { ROB: 0, SAM: 0, ANNA: 0, UNASSIGNED: 0 };
    
    history.messages
      .filter(msg => msg.bot_id && msg.blocks)
      .forEach(msg => {
        const text = msg.text || '';
        if (text.includes('ROB')) counts.ROB++;
        else if (text.includes('SAM')) counts.SAM++;
        else if (text.includes('ANNA')) counts.ANNA++;
        else counts.UNASSIGNED++;
      });
    
    return counts;
  } catch (error) {
    console.error('Error counting current tasks:', error);
    return { ROB: 0, SAM: 0, ANNA: 0, UNASSIGNED: 0 };
  }
}

function organizeTasks(tasks) {
  const tasksByPerson = { ROB: [], SAM: [], ANNA: [], UNASSIGNED: [] };
  
  for (const task of tasks) {
    const personKey = task.assignedTo?.key || 'UNASSIGNED';
    if (tasksByPerson[personKey]) {
      tasksByPerson[personKey].push(task);
    } else {
      tasksByPerson['UNASSIGNED'].push(task);
    }
  }
  
  // Sort tasks: overdue first, then by due date
  for (const tasks of Object.values(tasksByPerson)) {
    tasks.sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });
  }
  
  return tasksByPerson;
}

// Shared utility functions
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
    
    if (personName === 'Robert Schok') {
      return { key: 'ROB', name: 'ROB', emoji: '👨‍💼', fullName: 'Robert Schok' };
    } else if (personName === 'Samuel Robertson') {
      return { key: 'SAM', name: 'SAM', emoji: '👨‍💻', fullName: 'Samuel Robertson' };
    } else if (personName === 'Anna Schuster') {
      return { key: 'ANNA', name: 'ANNA', emoji: '👩‍💼', fullName: 'Anna Schuster' };
    }
    
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