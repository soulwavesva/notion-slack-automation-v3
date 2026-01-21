import { Client } from '@notionhq/client';
import { WebClient } from '@slack/web-api';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify Slack signature
    const signature = req.headers['x-slack-signature'];
    const timestamp = req.headers['x-slack-request-timestamp'];
    const body = JSON.stringify(req.body);
    
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