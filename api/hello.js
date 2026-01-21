export default function handler(req, res) {
  res.status(200).json({
    message: 'Notion-Slack Automation is running!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      sync: '/api/sync',
      interactions: '/api/slack-interactions',
      test: '/api/hello'
    }
  });
}