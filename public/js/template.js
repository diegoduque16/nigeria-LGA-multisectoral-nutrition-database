// The Excel data-entry template, built the same way in the browser (Download) and on the server (reminder emails).
// t = the /api/entry/sheet answer: { dataset, period, periodName, fields, rows }.
const STATUS = { none: 'Not started', draft: 'Started — not sent yet', submitted: 'Sent — waiting to be checked', accepted: 'Accepted', returned: 'Sent back — please correct' };

export function entryTemplateSheets(t) {
  const byUnit = t.dataset.byUnit;
  const fields = t.fields.filter((f) => f.editable);
  const head = ['Place ID', 'State', 'LGA', ...(byUnit ? ['Ward', 'Unit', 'Type'] : []), 'Status', ...fields.map((f) => f.name)];
  const fixed = head.length - fields.length;
  const ids = ['IDs — do not change', t.dataset.id, t.period, ...Array(fixed - 3).fill(''), ...fields.map((f) => f.id)];
  const rows = t.rows.map((r) => [r.id, r.state, r.lga, ...(byUnit ? [r.ward, r.name, r.type] : []), STATUS[r.status] || r.status, ...fields.map((f) => r.values[f.id] ?? '')]);
  return [
    { name: 'Data entry', rows: [head, ids, ...rows], widths: [14, 18, 24, ...(byUnit ? [22, 30, 16] : []), 22, ...fields.map(() => 18)] },
    { name: 'How to fill', rows: [[`${t.dataset.name} — ${t.periodName}`], ...[
      `One row per ${byUnit ? 'unit' : 'LGA'}; one column per number. Numbers already saved are filled in.`,
      'Type each number. Put 0 when there was nothing — every box is needed before a report can be sent.',
      'Do not change the Place ID column, the second row (IDs) or the column headings.',
      'Rows of reports that are already sent or accepted cannot be changed (ask your reviewer to send them back).',
      'Then upload it: open the upload link (or the data-entry page) and press “Upload filled Excel”. You see the result for each row.',
    ].map((x) => [x])], widths: [110] },
  ];
}

export const templateFileName = (t) => `${t.dataset.name.replace(/[^A-Za-z0-9]+/g, '_')}_${t.period}_data_entry.xlsx`;
