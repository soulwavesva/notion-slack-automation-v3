import { WebClient } from '@slack/web-api';

export default async function handler(req, res) {
  try {
    console.log('🧹 MANUAL CLEANUP: Starting aggressive message deletion...');
    
    const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
    
    // Get ALL messages from the channel
    let allMessages = [];
    let cursor = null;
    let pageCount = 0;
    
    do {
      const history = await slack.conversations.history({
        channel: process.env.SLACK_CHANNEL_ID,
        limit: 1000,
        cursor: cursor
      });
      
      allMessages = allMessages.concat(history.messages);
      cursor = history.response_metadata?.next_cursor;
      pageCount++;
      
      console.log(`📄 Fetched page ${pageCount}, got ${history.messages.length} messages`);
      
    } while (cursor && pageCount < 10); // Safety limit
    
    console.log(`📊 Total messages found: ${allMessages.length}`);
    
    // Try to delete ALL messages (not just bot messages)
    let deletedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    
    for (const message of allMessages) {
      // Skip user messages that are too recent (last 24 hours)
      const messageAge = Date.now() - (message.ts * 1000);
      const oneDayMs = 24 * 60 * 60 * 1000;
      
      if (!message.bot_id && messageAge < oneDayMs) {
        skippedCount++;
        continue;
      }
      
      try {
        console.log(`🗑️ Deleting message: ${message.ts} (bot: ${!!message.bot_id})`);
        
        await slack.chat.delete({
          channel: process.env.SLACK_CHANNEL_ID,
          ts: message.ts
        });
        
        deletedCount++;
        console.log(`✅ Deleted message ${message.ts}`);
        
        // Longer delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (deleteError) {
        failedCount++;
        console.log(`❌ Failed to delete ${message.ts}: ${deleteError.message}`);
      }
    }
    
    console.log(`🏁 CLEANUP COMPLETE:`);
    console.log(`   ✅ Deleted: ${deletedCount}`);
    console.log(`   ❌ Failed: ${failedCount}`);
    console.log(`   ⏭️ Skipped: ${skippedCount}`);
    
    res.status(200).json({
      success: true,
      message: 'Manual cleanup completed',
      stats: {
        totalMessages: allMessages.length,
        deleted: deletedCount,
        failed: failedCount,
        skipped: skippedCount
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Manual cleanup error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}