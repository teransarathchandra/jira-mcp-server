// A tiny local stand-in for Jira Cloud, used only to record the README demo.
// Serves the ABC-1 test fixture plus a few made-up issues; no real Jira data.
// Usage: node docs/demo/fake-jira.mjs [port]   (default 4545)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const port = Number(process.argv[2] ?? 4545);
const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/jira/ready-story.json', import.meta.url), 'utf8'));
const abc1 = fixture.routes['GET /rest/api/3/issue/ABC-1'].body;

const listed = (key, summary, status, priority, updated) => ({
  key,
  fields: { summary, status: { name: status }, priority: { name: priority }, updated },
});

const routes = {
  'GET /rest/api/3/myself': { accountId: 'demo-account', displayName: 'Demo Developer' },
  'GET /rest/api/3/field': [
    { id: 'summary', name: 'Summary', custom: false },
    { id: 'customfield_10020', name: 'Acceptance Criteria', custom: true },
    { id: 'customfield_10016', name: 'Story Points', custom: true },
    { id: 'customfield_10014', name: 'Epic Link', custom: true },
  ],
  'POST /rest/api/3/search/jql': {
    issues: [
      listed('ABC-1', abc1.fields.summary, 'To Do', 'Medium', '2026-10-20T09:00:00.000+0000'),
      listed('ABC-7', 'Export audit log as CSV', 'In Progress', 'High', '2026-10-19T15:30:00.000+0000'),
      listed('ABC-12', 'Dark mode for settings page', 'To Do', 'Low', '2026-10-17T11:10:00.000+0000'),
    ],
    isLast: true,
  },
  'GET /rest/api/3/issue/ABC-1': abc1,
};

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const body = routes[`${req.method} ${pathname}`];
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body ?? { errorMessages: ['Not found in the demo Jira'] }));
}).listen(port, '127.0.0.1');
