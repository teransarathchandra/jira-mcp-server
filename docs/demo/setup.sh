# Sourced (hidden) at the start of each tape in docs/demo: a local demo Jira,
# its credentials, a throwaway git repo with one branch, and `ask`, which calls
# a tool the way an MCP client does and renders the reply. No real data.
export JIRA_BASE_URL=http://127.0.0.1:4545 JIRA_EMAIL=demo@example.com JIRA_API_TOKEN=demo-token
export JIRA_DEFAULT_PROJECT_KEY=ABC MCP_CACHE_ENABLED=false
export JIRA_DELIVERY_AUDIT_LOG="${TMPDIR:-/tmp}/jira-delivery-demo-audit.log"
curl -s "$JIRA_BASE_URL/rest/api/3/myself" >/dev/null || { node docs/demo/fake-jira.mjs 4545 & sleep 1; }

DEMO_REPO="$(mktemp -d)/shop"
mkdir -p "$DEMO_REPO/src/auth" "$DEMO_REPO/tests"
git -C "$DEMO_REPO" init -q -b main
echo 'export function login() {}' > "$DEMO_REPO/src/auth/login.ts"
git -C "$DEMO_REPO" add -A && git -C "$DEMO_REPO" -c user.name=demo -c user.email=demo@example.com commit -qm init
git -C "$DEMO_REPO" checkout -qb feature/ABC-1-add-login-rate-limiting
cat > "$DEMO_REPO/src/auth/rateLimit.ts" <<'TS'
// Lock the account for 15 minutes after 5 failed login attempts.
export function recordFailedLogin(account: { failedAttempts: number; lockedUntil?: Date }) {
  account.failedAttempts += 1;
  if (account.failedAttempts >= 5) account.lockedUntil = new Date(Date.now() + 15 * 60_000);
}
TS
echo "test('locks the account after 5 failed login attempts', () => {});" > "$DEMO_REPO/tests/rateLimit.test.ts"
git -C "$DEMO_REPO" add -A && git -C "$DEMO_REPO" -c user.name=demo -c user.email=demo@example.com commit -qm "Lock account after 5 failed logins"

DEMO_DIR="$(pwd)/docs/demo"
ask() { node "$DEMO_DIR/ask.mjs" "$@" | glow -s dark -w 100 -; }
export PS1='$ '
clear
