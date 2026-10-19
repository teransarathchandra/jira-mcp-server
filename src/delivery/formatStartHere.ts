import type { WorkBriefData } from './workBriefTypes.js';

// The short "Start here" section that leads the jira_prepare_work_brief text.
// Readiness, blockers, the first action and the branch always stay; gaps,
// then extra questions, then extra actions are dropped to fit the limit.

const MAX_CHARS = 1500;

export function formatStartHere(data: WorkBriefData): string {
  const { readiness } = data;
  const head = ['## Start here', '', `**Readiness:** ${readiness.status} (score ${readiness.score}, confidence ${readiness.confidence})`];
  if (data.blockers.length > 0) {
    head.push(`**Blockers:** ${data.blockers.map((b) => `${b.key} (${b.status})`).join(', ')}`);
  }
  const actions = data.recommendedActions.map((a, i) => `${i + 1}. ${a.text}`);
  const questions = data.clarifyingQuestions.map((q) => `- ${q.text}`);
  const gaps = readiness.gaps.map((g) => `- ${g.text}`);

  const render = (nActions: number, nQuestions: number, nGaps: number): string =>
    [
      ...head,
      '',
      '**Next steps:**',
      ...actions.slice(0, nActions),
      ...(nQuestions > 0 ? ['', '**Questions to resolve:**', ...questions.slice(0, nQuestions)] : []),
      ...(nGaps > 0 ? ['', '**Gaps:**', ...gaps.slice(0, nGaps)] : []),
      '',
      `Branch: \`${data.branchName}\``,
    ].join('\n');

  let [nActions, nQuestions, nGaps] = [actions.length, questions.length, gaps.length];
  let text = render(nActions, nQuestions, nGaps);
  while (text.length > MAX_CHARS) {
    if (nGaps > 0) nGaps--;
    else if (nQuestions > 1) nQuestions--;
    else if (nActions > 1) nActions--;
    else if (nQuestions > 0) nQuestions--;
    else break;
    text = render(nActions, nQuestions, nGaps);
  }
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
}
