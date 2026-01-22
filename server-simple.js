import express from 'express';
import { Client } from '@notionhq/client';
import { WebClient } from '@slack/web-api';
import crypto from 'crypto';
import cron from 'node-cron';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Notion-Slack Automation is running!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      sync: '/api/sync',
      interactions: '/api/slack-interactions',
      test: '/'
    }
  });
});

// Sync endpoint - same logic as api/sync.js
app.get('/api/sync', async (req, res) => {
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
    
    // Fetch overdue and due today tasks
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
    
    // Combine and sort all urgent tasks (overdue first, then due today)
    const allTasks = [...overdueResponse.results, ...dueTodayResponse.results];
    
    console.log(`Found ${allTasks.length} urgent tasks (${overdueResponse.results.length} overdue, ${dueTodayResponse.results.length} due today)`);
    
    // Process up to 3 tasks total (most overdue first)
    const tasksToPost = allTasks.slice(0, 3);
    const postedTasks = [];
    
    for (const page of tasksToPost) {
      const task = {
        id: page.id,
        title: extractTitle(page),
        dueDate: extractDueDate(page),
        url: page.url,
        isOverdue: page.properties['Due Date']?.date?.start < todayStr
      };
      
      try {
        await postTaskToSlack(slack, task);
        postedTasks.push({ title: task.title, isOverdue: task.isOverdue });
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Failed to post task: ${task.title}`, error);
      }
    }
    
    console.log(`✅ Posted ${postedTasks.length} tasks to Slack`);
    
    res.status(200).json({
      success: true,
      message: 'Sync completed successfully',
      tasksPosted: postedTasks.length,
      overdueTasks: postedTasks.filter(t => t.isOverdue).length,
      dueTodayTasks: postedTasks.filter(t => !t.isOverdue).length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Sync error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Slack interactions endpoint
app.post('/api/slack-interactions', async (req, res) => {
  try {
    // Verify Slack signature
    const signature = req.headers['x-slack-signature'];
    const timestamp = req.headers['x-slack-request-timestamp'];
    const body = req.body.payload ? `payload=${req.body.payload}` : JSON.stringify(req.body);
    
    if (!verifySlackSignature(signature, timestamp, body)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Parse the payload
    const payload = JSON.parse(req.body.payload);
    
    if (payload.type === 'block_actions') {
      const action = payload.actions[0];
      
      if (action.action_id === 'mark_done') {
        const taskId = action.value;
        const userId = payload.user.id;
        
        console.log(`🎯 User ${userId} marked task ${taskId} as done`);
        
        // Initialize clients
        const notion = new Client({ auth: process.env.NOTION_API_KEY });
        const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
        
        try {
          // Mark task as done in Notion
          await notion.pages.update({
            page_id: taskId,
            properties: {
              'Checkbox': {
                checkbox: true
              }
            }
          });
          
          // Delete the Slack message
          await slack.chat.delete({
            channel: payload.channel.id,
            ts: payload.message.ts
          });
          
          // Send confirmation
          await slack.chat.postEphemeral({
            channel: payload.channel.id,
            user: userId,
            text: '✅ Task marked as complete in Notion!'
          });
          
          console.log(`✅ Task ${taskId} marked as done and message deleted`);
          
        } catch (error) {
          console.error('Error marking task as done:', error);
          
          // Send error message
          await slack.chat.postEphemeral({
            channel: payload.channel.id,
            user: userId,
            text: '❌ Failed to mark task as done. Please try again or update in Notion directly.'
          });
        }
      }
    }
    
    res.status(200).json({ success: true });
    
  } catch (error) {
    console.error('Slack interaction error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper functions
async function clearSlackChannel(slack) {
  try {
    console.log('🧹 Clearing existing Slack messages...');
    
    const history = await slack.conversations.history({
      channel: process.env.SLACK_CHANNEL_ID,
      limit: 100
    });
    
    for (const message of history.messages) {
      if (message.bot_id && message.blocks) {
        try {
          await slack.chat.delete({
            channel: process.env.SLACK_CHANNEL_ID,
            ts: message.ts
          });
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (deleteError) {
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
  
  await slack.chat.postMessage({
    channel: process.env.SLACK_CHANNEL_ID,
    text: `${task.title} - ${dueDate}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📌 *${task.title}*\n${dueDateText}`
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
  
  console.log(`📤 Posted task: "${task.title}"`);
}

function verifySlackSignature(signature, timestamp, body) {
  if (!signature || !timestamp) {
    return false;
  }
  
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - timestamp) > 300) {
    return false;
  }
  
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

// Schedule sync to run every hour during work hours (6 AM - 10 PM EST)
// This runs at minute 0 of every hour from 6 AM to 10 PM EST
cron.schedule('0 6-22 * * *', async () => {
  console.log('🕐 Scheduled sync starting...');
  try {
    const response = await fetch(`http://localhost:${PORT}/api/sync`);
    const result = await response.json();
    console.log('Scheduled sync result:', result);
  } catch (error) {
    console.error('Scheduled sync failed:', error);
  }
}, {
  timezone: "America/New_York"
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📅 Scheduled sync: Every hour from 6 AM - 10 PM EST`);
  console.log(`🔗 Endpoints:`);
  console.log(`   Health: http://localhost:${PORT}/`);
  console.log(`   Sync: http://localhost:${PORT}/api/sync`);
  console.log(`   Interactions: http://localhost:${PORT}/api/slack-interactions`);
});