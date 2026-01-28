# Notion-Slack Task Automation

Automated system that syncs overdue and due-today tasks from Notion to Slack with interactive "Done" buttons.

## Features

- **Daily Automation**: Runs at 3 AM EST and 9:45 AM EST via GitHub Actions
- **Person-Based Assignment**: Organizes tasks by ROB 👨‍💼, SAM 👨‍💻, ANNA 👩‍💼
- **Task Limits**: Maximum 3 tasks per person (9 total), 5-day range limit
- **Interactive Buttons**: Click "✅ Done" to mark tasks complete in Notion
- **Smart Prioritization**: Shows overdue tasks first, then due today, then upcoming
- **Auto-Cleanup**: Clears old messages before posting new ones

## API Endpoints

- `/api/sync` - Manual sync trigger & GitHub Actions endpoint
- `/api/slack-interactions` - Handles "Done" button clicks
- `/api/status` - Health check and system status

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

- **Morning Sync**: 3:00 AM EST (8:00 AM UTC)
- **Cleanup Sync**: 9:45 AM EST (2:45 PM UTC)
- **Automation**: GitHub Actions (no Vercel crons)
- **Task Range**: Maximum 5 days in advance

## Task Status Labels

- 🔴 **overdue**: Past due date
- 🟡 **due today**: Due today
- 📅 **upcoming**: Future due date (within 5 days)