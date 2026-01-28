export default async function handler(req, res) {
  try {
    const now = new Date();
    const utcTime = now.toISOString();
    const estTime = new Date(now.getTime() - (5 * 60 * 60 * 1000)).toISOString(); // EST is UTC-5
    
    res.status(200).json({
      status: 'healthy',
      version: 'v2026.01.28-CRON-FIX',
      currentTime: {
        utc: utcTime,
        est: estTime
      },
      nextCronRuns: {
        morning: '3:00 AM EST (8:00 UTC)',
        cleanup: '9:45 AM EST (14:45 UTC)'
      },
      endpoints: {
        sync: '/api/sync',
        interactions: '/api/slack-interactions',
        status: '/api/status'
      },
      features: {
        maxTasks: 9,
        maxTasksPerPerson: 3,
        dayLimit: 5,
        personMapping: {
          'Robert Schok': 'ROB 👨‍💼',
          'Samuel Robertson': 'SAM 👨‍💻', 
          'Anna Schuster': 'ANNA 👩‍💼'
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}