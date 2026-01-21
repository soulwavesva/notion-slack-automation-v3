# Notion-Slack Task Automation

Automated system that syncs overdue and due-today tasks from Notion to Slack with interactive "Done" buttons.

## Features

- **Daily Automation**: Runs at midnight EST (5 AM UTC) via Vercel cron
- **Person-Based Assignment**: Organizes tasks by ROB 👨‍💼, SAM 👨‍💻, ANNA 👩‍💼
- **Task Limits**: Maximum 3 tasks per person (9 total) in Slack
- **Interactive Buttons**: Click "✅ Done" to mark tasks complete in Notion
- **Smart Prioritization**: Shows overdue tasks first, then due today
- **Auto-Cleanup**: Clears old messages before posting new ones

## API Endpoints

- `/api/sync` - Manual sync trigger & daily cron job
- `/api/slack-interactions` - Handles "Done" button clicks
- `/api/hello` - Health check endpoint

## Environment Variables

Required in Vercel dashboard:

```
NOTION_API_KEY=your_notion_api_key_here
NOTION_DATABASE_ID=your_database_id_here
SLACK_BOT_TOKEN=your_slack_bot_token_here
SLACK_SIGNING_SECRET=your_slack_signing_secret_here
SLACK_CHANNEL_ID=your_slack_channel_id_here
NODE_ENV=production
```

## Deployment Steps

1. **Deploy to Vercel**:
   ```bash
   vercel --prod
   ```

2. **Configure Slack App**:
   - Set Request URL to: `https://your-domain.vercel.app/api/slack-interactions`
   - Enable Interactive Components in Slack App settings

3. **Test Deployment**:
   - Visit: `https://your-domain.vercel.app/api/hello`
   - Manual sync: `https://your-domain.vercel.app/api/sync`

## Person Mapping

- **Robert Schok** → ROB 👨‍💼
- **Samuel Robertson** → SAM 👨‍💻  
- **Anna Schuster** → ANNA 👩‍💼
- **Others/Unassigned** → UNASSIGNED ❓

## Schedule

- **Daily Cleanup**: 12:00 AM EST (midnight)
- **Cron Schedule**: `0 5 * * *` (5 AM UTC = 12 AM EST)

## Task Status Labels

- 🔴 **overdue**: Past due date
- 🟡 **due today**: Due today
- 📅 **Due**: Future due date