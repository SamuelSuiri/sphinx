// Synthetic example change for the landing-page preview. Not a real repository.
// Only the three question-relevant files carry diffs; the rest list their size only.
// Totals are derived from this list, so the header always matches it.

/** A hunk line is [kind, text] with kind ' ', '+' or '-'. Line numbers are derived. */
function hunk(id, oldStart, newStart, context, lines) {
  let oldNo = oldStart;
  let newNo = newStart;
  const rows = lines.map(([kind, text]) => {
    const row = { kind, text, old: kind === '+' ? null : oldNo, new: kind === '-' ? null : newNo };
    if (kind !== '+') oldNo += 1;
    if (kind !== '-') newNo += 1;
    return row;
  });
  const oldCount = rows.filter(row => row.kind !== '+').length;
  const newCount = rows.filter(row => row.kind !== '-').length;
  return { id, header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${context ? ` ${context}` : ''}`, rows };
}

const relevant = [
  {
    path: 'src/webhooks/payment-webhook.js',
    role: 'Webhook now enqueues instead of charging',
    hunks: [
      hunk('webhook-imports', 1, 1, '', [
        [' ', "import { verifySignature } from './verify.js';"],
        ['-', "import { billing } from '../billing/client.js';"],
        ['-', "import { invoices } from '../db/invoices.js';"],
        ['+', "import { queue } from '../queue/index.js';"],
      ]),
      hunk('webhook-enqueue', 18, 17, 'export async function handlePaymentWebhook(req, res) {', [
        [' ', '  const event = verifySignature(req);'],
        [' ', "  if (event.type !== 'invoice.payment_due') return res.sendStatus(204);"],
        ['-', '  const invoice = await invoices.load(event.data.invoiceId);'],
        ['-', '  await billing.charge({'],
        ['-', '    customerId: invoice.customerId,'],
        ['-', '    amount: invoice.amountDue,'],
        ['-', '  });'],
        ['-', '  await invoices.markPaid(invoice.id);'],
        ['-', '  res.sendStatus(200);'],
        ['+', "  await queue.enqueue('charge-invoice', {"],
        ['+', '    invoiceId: event.data.invoiceId,'],
        ['+', '    webhookEventId: event.id,'],
        ['+', '  });'],
        ['+', '  // Acknowledge fast; the worker charges in the background.'],
        ['+', '  res.sendStatus(202);'],
        [' ', '}'],
      ]),
    ],
  },
  {
    path: 'src/jobs/charge-invoice.js',
    role: 'New worker that calls the billing API',
    added: true,
    hunks: [
      hunk('worker', 0, 1, '', [
        ['+', "import { queue } from '../queue/index.js';"],
        ['+', "import { billing } from '../billing/client.js';"],
        ['+', "import { invoices } from '../db/invoices.js';"],
        ['+', ''],
        ['+', '// The queue delivers at least once: a job can run again after a'],
        ['+', '// worker crash, a timeout, or a lost acknowledgement.'],
        ['+', "queue.process('charge-invoice', { maxAttempts: 8 }, async (job) => {"],
        ['+', '  const invoice = await invoices.load(job.data.invoiceId);'],
        ['+', "  if (invoice.status === 'paid') return;"],
        ['+', ''],
        ['+', '  const charge = await billing.charge({'],
        ['+', '    customerId: invoice.customerId,'],
        ['+', '    amount: invoice.amountDue,'],
        ['+', '  });'],
        ['+', ''],
        ['+', '  await invoices.markPaid(invoice.id, charge.chargeId);'],
        ['+', '});'],
      ]),
    ],
  },
  {
    path: 'src/billing/client.js',
    role: 'Billing API timeouts now fail the job',
    hunks: [
      hunk('client-timeout', 11, 11, 'export const billing = {', [
        ['-', '  async charge({ customerId, amount }) {'],
        ['+', '  async charge({ customerId, amount }, { timeoutMs = 10_000 } = {}) {'],
        [' ', "    const response = await http.post('/v1/charges', {"],
        [' ', '      customer: customerId,'],
        [' ', '      amount,'],
        ['-', '    });'],
        ['+', '    }, { timeoutMs });'],
        ['+', '    // A timeout throws, so the queue retries the whole job.'],
        [' ', '    return { chargeId: response.id };'],
        [' ', '  },'],
      ]),
    ],
  },
].map(file => ({
  ...file,
  relevant: true,
  additions: file.hunks.flatMap(h => h.rows).filter(row => row.kind === '+').length,
  deletions: file.hunks.flatMap(h => h.rows).filter(row => row.kind === '-').length,
}));

const others = [
  ['src/queue/index.js', 412, 38],
  ['src/queue/redis-driver.js', 655, 0],
  ['src/queue/retry-policy.js', 238, 0],
  ['src/queue/dead-letter.js', 301, 0],
  ['src/jobs/index.js', 96, 12],
  ['src/jobs/send-receipt.js', 184, 0],
  ['src/jobs/sync-subscription.js', 372, 0],
  ['src/jobs/refund-invoice.js', 266, 0],
  ['src/billing/invoices.js', 318, 541],
  ['src/billing/proration.js', 207, 389],
  ['src/billing/tax.js', 121, 164],
  ['src/db/invoices.js', 143, 97],
  ['src/db/migrations/0042_job_runs.sql', 58, 0],
  ['src/db/migrations/0043_invoice_status.sql', 34, 0],
  ['src/api/routes/invoices.js', 172, 248],
  ['src/api/routes/admin-jobs.js', 219, 0],
  ['src/config/queue.js', 64, 0],
  ['src/observability/job-metrics.js', 188, 0],
  ['src/worker.js', 121, 0],
  ['src/legacy/billing-cron.js', 0, 1874],
  ['scripts/replay-dead-letters.js', 143, 0],
  ['test/jobs/charge-invoice.test.js', 412, 0],
  ['test/jobs/send-receipt.test.js', 196, 0],
  ['test/jobs/refund-invoice.test.js', 268, 0],
  ['test/queue/retry-policy.test.js', 241, 0],
  ['test/webhooks/payment-webhook.test.js', 187, 233],
  ['test/billing/proration.test.js', 162, 318],
  ['test/legacy/billing-cron.test.js', 0, 702],
  ['docs/billing-architecture.md', 146, 61],
  ['docker-compose.yml', 23, 4],
  ['package.json', 6, 2],
  ['package-lock.json', 2020, 306],
].map(([path, additions, deletions]) => ({ path, additions, deletions, relevant: false, hunks: [] }));

export const files = [...relevant, ...others].sort((a, b) => a.path.localeCompare(b.path));

export const change = {
  title: 'Move billing to background jobs',
  files: files.length,
  additions: files.reduce((sum, file) => sum + file.additions, 0),
  deletions: files.reduce((sum, file) => sum + file.deletions, 0),
};

// Evidence references point at new-file line numbers inside a bundled hunk.
export const evidence = {
  worker: { path: 'src/jobs/charge-invoice.js', hunk: 'worker', from: 7, to: 16, note: 'Charge happens before the job records it' },
  client: { path: 'src/billing/client.js', hunk: 'client-timeout', from: 11, to: 18, note: 'A timeout fails the job, so it retries' },
  webhook: { path: 'src/webhooks/payment-webhook.js', hunk: 'webhook-enqueue', from: 19, to: 24, note: 'Webhook enqueues the charge' },
};
