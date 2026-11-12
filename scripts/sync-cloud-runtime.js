// Cloud functions upload independently; copy shared source into each deployable directory.
const fs = require('fs'), path = require('path')
const root = path.join(__dirname, '..', 'cloudfunctions')
const functions = ['statistics', 'babyProfile', 'customRecord', 'aiChat', 'aiTasks', 'aiNotifications', 'aiReport', 'aiSettings', 'asrProxy', 'feedingRecord', 'growthRecord', 'diaryRecord', 'homeCards', 'milestoneRecord']
for (const name of functions) {
  const target = path.join(root, name, 'lib')
  fs.mkdirSync(target, { recursive: true })
  for (const file of ['runtime.js', 'aggregation.js', 'llm.js', 'schedule.js', 'ai-settings.js']) fs.copyFileSync(path.join(root, '_shared', file), path.join(target, file))
}
console.log(`Synced shared runtime to ${functions.length} functions`)
