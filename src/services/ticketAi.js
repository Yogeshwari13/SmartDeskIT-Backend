const categories = [
  ['Network', /wifi|wi-fi|vpn|internet|network|connect/i],
  ['Hardware', /laptop|screen|keyboard|mouse|device|monitor/i],
  ['HR', /leave|payroll|salary|employee|address|hr /i],
  ['Access', /access|permission|login|password|account/i],
];

export function enrichTicket(description = '') {
  const category = categories.find(([, pattern]) => pattern.test(description))?.[0] || 'Software';
  const priority = /critical|outage|everyone|production/i.test(description) ? 'Critical'
    : /urgent|blocked|unable|cannot|can.t/i.test(description) ? 'High'
    : /request|when possible/i.test(description) ? 'Low' : 'Medium';
  const team = category === 'HR' ? 'People Operations'
    : category === 'Network' ? 'IT Infrastructure'
    : category === 'Software' ? 'Business Systems' : 'IT Support';
  const clean = description.replace(/\s+/g, ' ').trim();
  const title = clean ? clean.charAt(0).toUpperCase() + clean.slice(1, 72).replace(/[.!?]+$/, '') : 'New support request';
  return {
    title,
    summary: clean || 'No description provided.',
    category,
    priority,
    team,
    suggestedSolution: `Review the ${category.toLowerCase()} troubleshooting guide and verify the requester’s device and account configuration.`
  };
}

export function resolutionNote(ticket, resolution = '') {
  return `Ticket ${ticket.id} has been resolved. ${resolution || `The ${ticket.category.toLowerCase()} issue was addressed by ${ticket.team}.`} The requester was notified and the incident is documented for audit purposes.`;
}
