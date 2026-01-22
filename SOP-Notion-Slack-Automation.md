# Standard Operating Procedure (SOP)
## Notion-Slack Task Automation System

### Overview
Automated system that syncs overdue and due-today tasks from Notion to Slack with interactive "Done" buttons. Runs on Vercel (free) and manages up to 9 tasks total (3 per person).

---

## System Schedule

### Automatic Cleanups
- **6:00 AM EST** (11:00 UTC) - Daily cleanup and task posting
- **9:45 AM EST** (14:45 UTC) - Second daily cleanup and task posting

### What Happens During Cleanup
1. **Deletes all old task messages** from Slack channel
2. **Fetches overdue and due-today tasks** from Notion
3. **Posts up to 3 tasks per person** (9 total max)
4. **Prioritizes overdue tasks first**, then due today

---

## Person Assignment

### Automatic Mapping
- **Robert Schok** → ROB 👨‍💼
- **Samuel Robertson** → SAM 👨‍💻
- **Anna Schuster** → ANNA 👩‍💼
- **Others/Unassigned** → UNASSIGNED ❓

### Task Limits
- **Maximum 3 tasks per person** at any time
- **Maximum 9 tasks total** in Slack channel
- **Overdue tasks prioritized** over due-today tasks

---

## How to Use the System

### 1. Adding Tasks in Notion
- Create tasks in your Notion database
- Set **Due Date** property
- Assign to person using **Assigned To** property
- Leave **Checkbox** property unchecked
- **Tasks appear automatically** at next cleanup (6 AM or 9:45 AM EST)

### 2. Completing Tasks via Slack
- Click **"✅ Done"** button on any task message
- **Automatically happens:**
  - Task marked as complete in Notion (checkbox checked)
  - Slack message deleted
  - **Next available task posted** for that person (if any)
  - Confirmation message sent to you

### 3. Manual Sync (Emergency Use)
- Visit: `https://notion-slack-automation-v3.vercel.app/api/sync`
- **Use when:**
  - Need immediate task update
  - System seems stuck
  - Testing after changes
- **What it does:** Same as automatic cleanup

---

## Task Status Labels

### In Slack Messages
- 🔴 **overdue**: Past due date
- 🟡 **due today**: Due today
- 📅 **Due**: Future due date (shouldn't appear in urgent list)

---

## System Endpoints

### Health Check
- **URL**: `https://notion-slack-automation-v3.vercel.app/api/hello`
- **Purpose**: Verify system is running
- **Response**: JSON with system status and available endpoints

### Manual Sync
- **URL**: `https://notion-slack-automation-v3.vercel.app/api/sync`
- **Purpose**: Force immediate task sync
- **Response**: JSON with tasks posted and person breakdown

### Slack Interactions
- **URL**: `https://notion-slack-automation-v3.vercel.app/api/slack-interactions`
- **Purpose**: Handles "Done" button clicks (internal use)
- **Note**: Must be configured in Slack app settings

---

## Troubleshooting

### No Tasks Appearing in Slack
1. **Check Notion database:**
   - Tasks have Due Date set to today or earlier
   - Checkbox property is unchecked
   - Assigned To property is set correctly
2. **Check system status:** Visit `/api/hello` endpoint
3. **Force manual sync:** Visit `/api/sync` endpoint

### "Done" Button Not Working
1. **Verify Slack app configuration:**
   - Request URL set to `/api/slack-interactions`
   - Interactive Components enabled
2. **Check environment variables** in Vercel dashboard
3. **Test manual sync** to ensure basic functionality works

### Too Many/Few Tasks Showing
- **System enforces 3 tasks per person maximum**
- **Only shows overdue and due-today tasks**
- **Check Due Date property** in Notion for accuracy

### Duplicate Messages
- **Should not happen** - system clears old messages before posting new ones
- **If it occurs:** Use manual sync to reset

---

## System Configuration

### Environment Variables (Vercel Dashboard)
```
NOTION_API_KEY=your_notion_api_key_here
NOTION_DATABASE_ID=your_database_id_here
SLACK_BOT_TOKEN=your_slack_bot_token_here
SLACK_SIGNING_SECRET=your_slack_signing_secret_here
SLACK_CHANNEL_ID=your_slack_channel_id_here
NODE_ENV=production
```

### Slack App Settings
- **Request URL**: `https://notion-slack-automation-v3.vercel.app/api/slack-interactions`
- **Required Scopes**: `chat:write`, `chat:delete`
- **Interactive Components**: Enabled

### Notion Database Requirements
- **Checkbox** property (for task completion)
- **Due Date** property (date type)
- **Assigned To** property (person type)
- **Title** property (for task names)

---

## Daily Workflow

### Morning (6:00 AM EST)
- System automatically clears old messages
- Posts up to 9 urgent tasks (3 per person)
- Team sees fresh task list in Slack

### Mid-Morning (9:45 AM EST)
- Second cleanup in case new urgent tasks were added
- Ensures no urgent tasks are missed

### Throughout the Day
- Team clicks "✅ Done" to complete tasks
- System automatically posts next available tasks
- Maintains 3-tasks-per-person limit

### Evening
- Team can add new tasks to Notion
- Tasks will appear at next cleanup (6 AM or 9:45 AM)

---

## Cost Breakdown

### Current Costs
- **Vercel**: $0/month (free tier)
- **Notion**: $0/month (free tier)
- **Slack**: $0/month (free tier)
- **Total**: **$0/month**

### Previous Railway Cost
- **Railway**: $5/month (cancelled)
- **Savings**: $5/month = $60/year

---

## System Benefits

### Automation
- ✅ **No manual task posting** required
- ✅ **Automatic cleanup** twice daily
- ✅ **Smart task prioritization** (overdue first)
- ✅ **Person-based organization**

### Reliability
- ✅ **Serverless architecture** (no server downtime)
- ✅ **Vercel's reliable cron jobs**
- ✅ **Error handling and logging**
- ✅ **Duplicate prevention**

### User Experience
- ✅ **One-click task completion**
- ✅ **Automatic next-task posting**
- ✅ **Clean, organized messages**
- ✅ **Real-time Notion updates**

---

## Emergency Procedures

### System Down
1. Check Vercel dashboard for deployment status
2. Test health endpoint: `/api/hello`
3. Check environment variables are set
4. Redeploy if necessary

### Wrong Tasks Showing
1. Verify Notion database Due Date values
2. Check person assignments in Notion
3. Use manual sync: `/api/sync`

### Slack Integration Broken
1. Verify Slack app Request URL
2. Check Slack bot token validity
3. Test with manual sync first

---

**Last Updated**: January 22, 2026  
**System Version**: v3.0  
**Deployment**: Vercel (notion-slack-automation-v3)