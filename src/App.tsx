import { useEffect, useMemo, useState } from 'react';

type BillStatus = 'paid' | 'unpaid';

type Bill = {
  id: string;
  name: string;
  amount: number;
  dueDate: string;
  status: BillStatus;
  recurring: boolean;
  autopay: boolean;
  note: string;
  url: string;
  username: string;
  password: string;
};

type BillFormState = {
  name: string;
  amount: string;
  dueDate: string;
  recurring: boolean;
  autopay: boolean;
  note: string;
  url: string;
  username: string;
  password: string;
};

type AppState = {
  bills: Bill[];
  budgetTarget: number;
  reminderDays: number;
};

const STORAGE_KEY = 'monthly-bills-data-v3';
const NOTIFIED_KEY = 'monthly-bills-last-notified';

const defaultBills: Bill[] = [];

type StoredBill = Omit<Bill, 'dueDate' | 'recurring'> & {
  dueDate?: string;
  dueDay?: number;
  recurring?: boolean;
};

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getNextDateForDay(dueDay: number) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const normalizedDueDay = Math.min(Math.max(dueDay, 1), daysInMonth);
  const date = new Date(year, month, normalizedDueDay);

  if (date < new Date(year, month, today.getDate())) {
    const nextMonthDays = new Date(year, month + 2, 0).getDate();
    date.setMonth(month + 1, Math.min(dueDay, nextMonthDays));
  }

  return toDateInputValue(date);
}

function migrateBill(bill: StoredBill): Bill {
  const { dueDay, ...billWithoutDueDay } = bill;
  const dueDate = typeof bill.dueDate === 'string' && bill.dueDate ? bill.dueDate : getNextDateForDay(dueDay ?? 1);
  const recurring = typeof bill.recurring === 'boolean' ? bill.recurring : false;

  return { ...billWithoutDueDay, dueDate, recurring };
}

const emptyForm = (): BillFormState => ({
  name: '',
  amount: '',
  dueDate: '',
  recurring: false,
  autopay: false,
  note: '',
  url: '',
  username: '',
  password: '',
});

const defaultState = (): AppState => ({
  bills: defaultBills,
  budgetTarget: 0,
  reminderDays: 1,
});

function readStoredState(): AppState {
  const stored = localStorage.getItem(STORAGE_KEY);

  if (!stored) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(stored) as Partial<AppState> | Bill[];
    if (Array.isArray(parsed)) {
      return { ...defaultState(), bills: parsed.map(migrateBill) };
    }

    const bills = Array.isArray(parsed.bills) ? parsed.bills.map(migrateBill) : defaultBills;
    const budgetTarget = typeof parsed.budgetTarget === 'number' ? parsed.budgetTarget : defaultState().budgetTarget;
    const reminderDays = typeof parsed.reminderDays === 'number' ? parsed.reminderDays : defaultState().reminderDays;

    return {
      bills,
      budgetTarget,
      reminderDays,
    };
  } catch {
    return defaultState();
  }

  return defaultState();
}

function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

function canNotify() {
  return isNotificationSupported() && Notification.permission === 'granted';
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function normalizeUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    return new URL(withProtocol).href;
  } catch {
    return trimmed;
  }
}

function parseDateInput(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function getDaysUntilDue(dueDate: string) {
  const due = parseDateInput(dueDate);
  if (!due) {
    return Number.POSITIVE_INFINITY;
  }

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  return Math.round((due.getTime() - startOfToday.getTime()) / millisecondsPerDay);
}

function formatDueDate(dueDate: string) {
  const due = parseDateInput(dueDate);
  if (!due) {
    return 'No due date';
  }

  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(due);
}

function formatDaysUntilDue(dueDate: string) {
  const days = getDaysUntilDue(dueDate);

  if (!Number.isFinite(days)) {
    return 'No due date';
  }

  if (days < 0) {
    return `Overdue by ${Math.abs(days)} day${days === -1 ? '' : 's'}`;
  }

  if (days === 0) {
    return 'Due today';
  }

  return `Due in ${days} day${days === 1 ? '' : 's'}`;
}

function getMonthKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getMonthLabel(date: Date) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(date);
}

function getMonthlySummary(bills: Bill[]) {
  const today = new Date();
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() + index, 1);
    return {
      key: getMonthKey(date),
      label: getMonthLabel(date),
      total: 0,
      count: 0,
    };
  });

  bills.forEach((bill) => {
    const due = parseDateInput(bill.dueDate);
    if (!due) {
      return;
    }

    const dueMonthKey = getMonthKey(new Date(due.getFullYear(), due.getMonth(), 1));

    months.forEach((month) => {
      if (bill.recurring) {
        if (month.key >= dueMonthKey) {
          month.total += bill.amount;
          month.count += 1;
        }

        return;
      }

      if (month.key === dueMonthKey) {
        month.total += bill.amount;
        month.count += 1;
      }
    });
  });

  return months;
}

export default function App() {
  const initialState = useMemo(() => readStoredState(), []);
  const [bills, setBills] = useState<Bill[]>(initialState.bills);
  const [budgetTarget, setBudgetTarget] = useState<number>(initialState.budgetTarget);
  const [reminderDays, setReminderDays] = useState<number>(initialState.reminderDays);
  const [form, setForm] = useState<BillFormState>(() => emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);

  useEffect(() => {
    const state: AppState = { bills, budgetTarget, reminderDays };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [bills, budgetTarget, reminderDays]);

  useEffect(() => {
    if (!canNotify() || reminderDays < 1) {
      return;
    }

    const now = new Date();
    const notificationKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${reminderDays}-${bills.length}`;

    if (localStorage.getItem(NOTIFIED_KEY) === notificationKey) {
      return;
    }

    const upcoming = bills.filter((bill) => bill.status === 'unpaid' && getDaysUntilDue(bill.dueDate) <= reminderDays);

    if (upcoming.length === 0) {
      return;
    }

    upcoming.slice(0, 3).forEach((bill) => {
      new Notification(`${bill.name} is due soon`, {
        body: `${formatCurrency(bill.amount)}: ${formatDaysUntilDue(bill.dueDate).toLowerCase()}.`,
      });
    });

    localStorage.setItem(NOTIFIED_KEY, notificationKey);
  }, [bills, reminderDays]);

  const totals = useMemo(() => {
    const total = bills.reduce((sum, bill) => sum + bill.amount, 0);
    const paid = bills.filter((bill) => bill.status === 'paid').reduce((sum, bill) => sum + bill.amount, 0);
    const unpaid = total - paid;
    const variance = budgetTarget - total;
    const reminderCount = bills.filter((bill) => bill.status === 'unpaid' && getDaysUntilDue(bill.dueDate) <= reminderDays).length;
    const upcoming = [...bills]
      .sort((left, right) => getDaysUntilDue(left.dueDate) - getDaysUntilDue(right.dueDate))
      .slice(0, 3);

    return { total, paid, unpaid, variance, reminderCount, upcoming };
  }, [bills, budgetTarget, reminderDays]);

  const monthlySummary = useMemo(() => getMonthlySummary(bills), [bills]);

  function resetForm() {
    setForm(emptyForm());
    setEditingId(null);
  }

  function closeForm() {
    resetForm();
    setIsFormOpen(false);
  }

  function openNewBillForm() {
    resetForm();
    setIsFormOpen(true);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amount = Number(form.amount);
    const dueDate = parseDateInput(form.dueDate);

    if (!form.name.trim() || !Number.isFinite(amount) || amount <= 0 || !dueDate) {
      return;
    }

    if (editingId) {
      setBills((currentBills) =>
        currentBills.map((bill) =>
          bill.id === editingId
            ? { ...bill, name: form.name.trim(), amount, dueDate: form.dueDate, recurring: form.recurring, autopay: form.autopay, note: form.note.trim(), url: form.url.trim(), username: form.username.trim(), password: form.password.trim() }
            : bill,
        ),
      );
    } else {
      setBills((currentBills) => [
        ...currentBills,
        {
          id: crypto.randomUUID(),
          name: form.name.trim(),
          amount,
          dueDate: form.dueDate,
          status: 'unpaid',
          recurring: form.recurring,
          autopay: form.autopay,
          note: form.note.trim(),
          url: form.url.trim(),
          username: form.username.trim(),
          password: form.password.trim(),
        },
      ]);
    }

    resetForm();
    setIsFormOpen(false);
  }

  function handleEdit(bill: Bill) {
    setEditingId(bill.id);
    setForm({
      name: bill.name,
      amount: String(bill.amount),
      dueDate: bill.dueDate,
      recurring: bill.recurring,
      autopay: bill.autopay,
      note: bill.note,
      url: bill.url,
      username: bill.username,
      password: bill.password,
    });
    setIsFormOpen(true);
  }

  function handleDelete(id: string) {
    setBills((currentBills) => currentBills.filter((bill) => bill.id !== id));
    if (editingId === id) {
      resetForm();
    }
  }

  function toggleStatus(id: string) {
    setBills((currentBills) =>
      currentBills.map((bill) => {
        if (bill.id !== id) {
          return bill;
        }

        return { ...bill, status: bill.status === 'paid' ? 'unpaid' : 'paid' };
      }),
    );
  }

  function openBillUrl(bill: Bill) {
    const url = normalizeUrl(bill.url);
    if (!url) {
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function copyToClipboard(value: string) {
    if (!value || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
    } catch {
    }
  }

  async function requestNotifications() {
    if (!isNotificationSupported()) {
      return;
    }

    if (Notification.permission === 'granted') {
      return;
    }

    await Notification.requestPermission();
  }

  return (
    <main className="shell">
      <section className="grid stats">
        <article>
          <span>Due this month ({bills.length} active bills)</span>
          <strong>{formatCurrency(totals.total)}</strong>
        </article>
        <article>
          <span>Total monthly spend</span>
          <strong>{formatCurrency(totals.total)}</strong>
        </article>
        <article>
          <span>Paid so far</span>
          <strong>{formatCurrency(totals.paid)}</strong>
        </article>
        <article>
          <span>Still due</span>
          <strong>{formatCurrency(totals.unpaid)}</strong>
        </article>
        <article>
          <span>Budget variance</span>
          <strong className={totals.variance >= 0 ? 'positive' : 'negative'}>{formatCurrency(totals.variance)}</strong>
        </article>
      </section>

      <section className="content-grid">
        <section className="panel form-launch-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Actions</p>
              <h2>Manage bills</h2>
            </div>
          </div>

          <div className="action-row">
            <button type="button" className="primary" onClick={openNewBillForm}>Add bill</button>
            <button type="button" className="ghost" onClick={requestNotifications}>
              {isNotificationSupported() && Notification.permission === 'granted' ? 'Notifications enabled' : 'Enable reminders'}
            </button>
          </div>

          <p className="helper-text">
            {totals.reminderCount} unpaid bill{totals.reminderCount === 1 ? '' : 's'} are inside your reminder window.
          </p>

          <div className="two-col">
            <label>
              Monthly budget target
              <input type="number" min="0" step="1" value={budgetTarget} onChange={(event) => setBudgetTarget(Number(event.target.value) || 0)} placeholder="1800" />
            </label>
            <label>
              Reminder window (days)
              <input type="number" min="1" max="31" value={reminderDays} onChange={(event) => setReminderDays(Number(event.target.value) || 1)} placeholder="5" />
            </label>
          </div>
        </section>

        <aside className="panel side-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Upcoming</p>
              <h2>Next bills due</h2>
            </div>
          </div>

          <div className="reminder-card">
            <strong>{totals.reminderCount}</strong>
            <span>bill{totals.reminderCount === 1 ? '' : 's'} need attention within {reminderDays} days</span>
          </div>

          <div className="upcoming-list">
            {totals.upcoming.map((bill) => (
              <div key={bill.id} className="upcoming-item">
                <div>
                  <strong>{bill.name}</strong>
                </div>
                <div>
                  <strong>{formatCurrency(bill.amount)}</strong>
                  <span>{formatDaysUntilDue(bill.dueDate)}</span>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="panel bills-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Bills</p>
            <h2>All monthly bills</h2>
          </div>
        </div>

        <div className="bill-list">
          {bills.map((bill) => (
            <article key={bill.id} className={`bill-row ${bill.status === 'paid' ? 'paid' : ''}`}>
              <div>
                <div className="bill-title-row">
                  <h3>{bill.name}</h3>
                </div>
                <p>{bill.note || 'No notes yet'}</p>
                <div className="bill-meta">
                  <span>{formatDueDate(bill.dueDate)}</span>
                  <span>{bill.recurring ? 'Recurring monthly' : 'One-time payment'}</span>
                  <span>{bill.autopay ? 'Autopay on' : 'Autopay off'}</span>
                  <span>{formatDaysUntilDue(bill.dueDate)}</span>
                </div>
                {(bill.url || bill.username || bill.password) && (
                  <div className="bill-meta">
                    {bill.url ? (
                      <span><button type="button" className="inline-link-button" onClick={() => openBillUrl(bill)}>Open page</button></span>
                    ) : null}
                    {bill.username ? (
                      <span className="credential-chip">
                        User: {bill.username}
                        <button type="button" className="copy-button" onClick={() => copyToClipboard(bill.username)}>Copy</button>
                      </span>
                    ) : null}
                    {bill.password ? (
                      <span className="credential-chip">
                        Pass: {bill.password}
                        <button type="button" className="copy-button" onClick={() => copyToClipboard(bill.password)}>Copy</button>
                      </span>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="bill-actions">
                <strong>{formatCurrency(bill.amount)}</strong>
                <label className="status-toggle">
                  <input type="checkbox" checked={bill.status === 'paid'} onChange={() => toggleStatus(bill.id)} />
                  {bill.status === 'paid' ? 'Paid' : 'Unpaid'}
                </label>
                <div className="action-buttons">
                  <button type="button" className="ghost" onClick={() => handleEdit(bill)}>Edit</button>
                  <button type="button" className="danger" onClick={() => handleDelete(bill.id)}>Delete</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel monthly-summary-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Summary</p>
            <h2>Monthly spend</h2>
          </div>
        </div>

        <div className="summary-table-wrap">
          <table className="summary-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Bills</th>
                <th>Projected spend</th>
              </tr>
            </thead>
            <tbody>
              {monthlySummary.map((month) => (
                <tr key={month.key}>
                  <td>{month.label}</td>
                  <td>{month.count}</td>
                  <td>{formatCurrency(month.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {isFormOpen ? (
        <div className="form-modal-overlay" role="dialog" aria-modal="true">
          <form className="panel form-panel form-modal" onSubmit={handleSubmit}>
            <div className="panel-header">
              <div>
                <p className="panel-kicker">{editingId ? 'Update bill' : 'Add bill'}</p>
                <h2>{editingId ? 'Edit a recurring payment' : 'Create a new monthly bill'}</h2>
              </div>
              <button type="button" className="ghost" onClick={closeForm}>Close</button>
            </div>

            <label>
              Bill name
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Electricity" />
            </label>

            <div className="two-col">
              <label>
                Amount
                <input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} placeholder="120.00" />
              </label>
              <label>
                Due date
                <input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
              </label>
            </div>

            <div className="checkbox-grid">
              <label className="checkbox-row">
                <input type="checkbox" checked={form.recurring} onChange={(event) => setForm({ ...form, recurring: event.target.checked })} />
                Recurring monthly
              </label>

              <label className="checkbox-row">
                <input type="checkbox" checked={form.autopay} onChange={(event) => setForm({ ...form, autopay: event.target.checked })} />
                Autopay enabled
              </label>
            </div>

            <label>
              URL
              <input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://example.com" />
            </label>

            <div className="two-col">
              <label>
                Username
                <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="username" />
              </label>
              <label>
                Password
                <input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="password" />
              </label>
            </div>

            <label>
              Notes
              <textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Account number, provider, or reminders" rows={4} />
            </label>

            <div className="form-modal-actions">
              <button type="button" className="ghost" onClick={closeForm}>Cancel</button>
              <button type="submit" className="primary">{editingId ? 'Save changes' : 'Add bill'}</button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
