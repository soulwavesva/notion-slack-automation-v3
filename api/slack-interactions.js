import { Client } from '@notionhq/client';
import { WebClient } from '@slack/web-api';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔄 Slack interaction received');

    // Get the raw body for signature verification
    let rawBody;
    let payload;
    
    if (typeof req.body === 'string') {
      rawBody = req.body;
      // Parse URL-encoded payload
      const params = new URLSearchParams(rawBody);
      payload = JSON.parse(params.get('payload'));
    } else if (req.body.payload) {
      // Already parsed by Vercel - reconstruct raw body
      rawBody = `payload=${encodeURIComponent(typeof req.body.payload === 'string' ? req.body.payload : JSON.stringify(req.body.payload))}`;
      payload = typeof req.body.payload === 'string' ? JSON.parse(req.body.payload) : req.body.payload;
    } else {
      console.error('❌ Invalid payload format');
      return res.status(400).json({ error: 'Invalid payload format' });
    }

    console.log('Parsed payload type:', payload.type);
    console.log('Parsed payload user:', payload.user?.name);

    // TEMPORARILY SKIP signature verification for debugging
    console.log('⚠️ SKIPPING signature verification for debugging');
    
    if (payload.type === 'block_actions') {
      const action = payload.actions[0];
      
      if (action.action_id === 'mark_done') {
        const taskId = action.value;
        const userId = payload.user.id;
        const userName = payload.user.name;
        
        console.log(`🎯 User ${userName} (${userId}) marked task ${taskId} as done`);
        
        // Initialize clients
        const notion = new Client({ auth: process.env.NOTION_API_KEY });
        const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
        
        try {
          console.log('📝 Updating Notion task...');
          
          // Mark task as done in Notion
          await notion.pages.update({
            page_id: taskId,
            properties: {
              'Checkbox': {
                checkbox: true
              }
            }
          });
          
          console.log('✅ Notion task updated');
          console.log('🗑️ Deleting Slack message...');
          
          // Delete the Slack message
          await slack.chat.delete({
            channel: payload.channel.id,
            ts: payload.message.ts
          });
          
          console.log('✅ Slack message deleted');
          
          // Send confirmation
          await slack.chat.postEphemeral({
            channel: payload.channel.id,
            user: userId,
            text: '✅ Task marked as complete in Notion!'
          });
          
          console.log(`✅ Task ${taskId} completed successfully`);
          
          // Post next available task for this person
          await postNextTaskForPerson(notion, slack, payload.message.text);
          
        } catch (error) {
          console.error('❌ Error marking task as done:', error);
          
          // Send error message
          await slack.chat.postEphemeral({
            channel: payload.channel.id,
            user: userId,
            text: `❌ Failed to mark task as done: ${error.message}`
          });
        }
      }
    }
    
    res.status(200).json({ success: true });
    
  } catch (error) {
    console.error('❌ Slack interaction error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}

async function postNextTaskForPerson(notion, slack, completedTaskText) {
  try {
    // Determine which person completed the task
    let personKey = 'UNASSIGNED';
    if (completedTaskText && completedTaskText.includes('ROB')) personKey = 'ROB';
    else if (completedTaskText && completedTaskText.includes('SAM')) personKey = 'SAM';
    else if (completedTaskText && completedTaskText.includes('ANNA')) personKey = 'ANNA';
    
    console.log(`🔍 Looking for next task for ${personKey}`);
    console.log(`📝 Completed task text: "${completedTaskText}"`);
    
    // Get current task count for this person
    const currentCount = await getCurrentTaskCountForPerson(slack, personKey);
    console.log(`📊 Current task count for ${personKey}: ${currentCount}`);
    
    if (currentCount >= 3) {
      console.log(`⚠️ ${personKey} already has 3 tasks, not posting more`);
      return;
    }
    
    // First, try to find a task specifically for this person
    const nextTask = await getNextTaskForPerson(notion, slack, personKey);
    
    if (nextTask) {
      console.log(`📤 Found next task for ${personKey}: "${nextTask.title}"`);
      await postTaskToSlack(slack, nextTask);
      console.log(`✅ Posted next task for ${personKey}: "${nextTask.title}"`);
      return;
    }
    
    console.log(`ℹ️ No more tasks available for ${personKey}`);
    
    // If no task for this specific person, try to find tasks for other people who have < 3 tasks
    const allPersons = ['ROB', 'SAM', 'ANNA'];
    
    for (const otherPerson of allPersons) {
      if (otherPerson === personKey) continue; // Skip the person who just completed a task
      
      const otherPersonCount = await getCurrentTaskCountForPerson(slack, otherPerson);
      console.log(`📊 Current task count for ${otherPerson}: ${otherPersonCount}`);
      
      if (otherPersonCount < 3) {
        const otherPersonTask = await getNextTaskForPerson(notion, slack, otherPerson);
        if (otherPersonTask) {
          console.log(`📤 Found task for ${otherPerson}: "${otherPersonTask.title}"`);
          await postTaskToSlack(slack, otherPersonTask);
          console.log(`✅ Posted task for ${otherPerson}: "${otherPersonTask.title}"`);
          return;
        }
      }
    }
    
    // Only if no assigned tasks are available, try unassigned tasks
    console.log(`🔍 No assigned tasks available, checking unassigned tasks...`);
    const unassignedTask = await getNextTaskForPerson(notion, slack, 'UNASSIGNED');
    if (unassignedTask) {
      console.log(`📤 Found unassigned task to fill slot: "${unassignedTask.title}"`);
      await postTaskToSlack(slack, unassignedTask);
      console.log(`✅ Posted unassigned task: "${unassignedTask.title}"`);
    } else {
      console.log(`ℹ️ No tasks available at all`);
    }
    
  } catch (error) {
    console.error('❌ Error posting next task:', error);
  }
}

async function getCurrentTaskCountForPerson(slack, personKey) {
  try {
    const history = await slack.conversations.history({
      channel: process.env.SLACK_CHANNEL_ID,
      limit: 50
    });
    
    return history.messages
      .filter(msg => msg.bot_id && msg.blocks)
      .filter(msg => (msg.text || '').includes(personKey))
      .length;
      
  } catch (error) {
    console.error('Error counting tasks for person:', error);
    return 3; // Assume max to be safe
  }
}

async function getNextTaskForPerson(notion, slack, personKey) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(new Date().getDate() + 7);
    const sevenDaysStr = sevenDaysFromNow.toISOString().split('T')[0];
    
    console.log(`🔍 Searching for tasks for ${personKey} from ${today} to ${sevenDaysStr}`);
    
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
            date: { before: today }
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
            date: { equals: today }
          }
        ]
      },
      sorts: [{ property: 'Due Date', direction: 'ascending' }]
    });
    
    // Get upcoming tasks (next 7 days)
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
              after: today,
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
    
    console.log(`📊 Found ${allTasks.length} total available tasks`);
    
    // Find tasks for this person that aren't already in Slack
    const currentSlackTasks = await getCurrentSlackTaskIds(slack);
    console.log(`📊 Current Slack task IDs: ${currentSlackTasks.length} tasks`);
    
    for (const page of allTasks) {
      const task = {
        id: page.id,
        title: extractTitle(page),
        dueDate: extractDueDate(page),
        url: page.url,
        assignedTo: extractAssignedPerson(page),
        isOverdue: page.properties['Due Date']?.date?.start < today,
        isDueToday: page.properties['Due Date']?.date?.start === today,
        isUpcoming: page.properties['Due Date']?.date?.start > today
      };
      
      console.log(`🔍 Checking task "${task.title}" assigned to ${task.assignedTo?.key || 'UNASSIGNED'}`);
      
      // Check if this task is for the right person and not already posted
      const isRightPerson = task.assignedTo?.key === personKey;
      const notAlreadyPosted = !currentSlackTasks.includes(task.id);
      
      console.log(`   - Right person (${personKey}): ${isRightPerson}`);
      console.log(`   - Not already posted: ${notAlreadyPosted}`);
      
      if (isRightPerson && notAlreadyPosted) {
        console.log(`✅ Found next task: "${task.title}" for ${personKey}`);
        return task;
      }
    }
    
    console.log(`❌ No available tasks found for ${personKey}`);
    return null;
    
  } catch (error) {
    console.error('❌ Error getting next task:', error);
    return null;
  }
}

async function getCurrentSlackTaskIds(slack) {
  try {
    const history = await slack.conversations.history({
      channel: process.env.SLACK_CHANNEL_ID,
      limit: 50
    });
    
    const taskIds = [];
    
    for (const msg of history.messages) {
      if (msg.bot_id && msg.blocks) {
        // Extract task ID from button value
        for (const block of msg.blocks) {
          if (block.type === 'section' && block.accessory?.value) {
            taskIds.push(block.accessory.value);
          }
        }
      }
    }
    
    return taskIds;
    
  } catch (error) {
    console.error('Error getting current Slack task IDs:', error);
    return [];
  }
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
  let buttonStyle = 'primary'; // Default green button
  
  if (task.dueDate) {
    if (task.dueDate < today) {
      dueDateText = `🔴 *overdue*: ${dueDate}`;
      buttonStyle = 'primary'; // Green button for overdue (changed from danger)
    } else if (task.dueDate === today) {
      dueDateText = `🟡 *due today*: ${dueDate}`;
      buttonStyle = 'primary'; // Green button for due today
    } else {
      dueDateText = `📅 *upcoming*: ${dueDate}`;
      buttonStyle = undefined; // Transparent/default button for upcoming
    }
  }
  
  const assignedText = task.assignedTo ? `${task.assignedTo.emoji} *${task.assignedTo.name}*` : '❓ *UNASSIGNED*';
  
  const buttonBlock = {
    type: 'button',
    text: { type: 'plain_text', text: '✅ Done' },
    action_id: 'mark_done',
    value: task.id
  };
  
  // Only add style if it's defined (upcoming tasks get default/transparent style)
  if (buttonStyle) {
    buttonBlock.style = buttonStyle;
  }
  
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
        accessory: buttonBlock
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `<${task.url}|View in Notion>` }]
      }
    ]
  });
  
  console.log(`📤 Posted next task: "${task.title}" for ${task.assignedTo?.name || 'UNASSIGNED'}`);
}

function verifySlackSignature(signature, timestamp, body) {
  if (!signature || !timestamp) {
    return false;
  }
  
  // Check if timestamp is within 5 minutes
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - timestamp) > 300) {
    return false;
  }
  
  // Create signature
  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', process.env.SLACK_SIGNING_SECRET)
    .update(sigBasestring)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(signature)
  );
}