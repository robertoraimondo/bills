import { useEffect, useMemo, useState } from 'react';

type BillStatus = 'paid' | 'unpaid';

type Bill = {
  id: string;
  name: string;
  amount: number;
  dueDay: number;
  category: string;
  status: BillStatus;
  autopay: boolean;
  note: string;
  url: string;
  username: string;
  password: string;
};

type BillFormState = {
  name: string;
  amount: string;
  dueDay: string;
  category: string;
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

type BillExport = {
  version: 1;
  exportedAt: string;
  state: AppState;
};

const STORAGE_KEY = 'monthly-bills-data-v2';
const NOTIFIED_KEY = 'monthly-bills-last-notified';

const defaultBills: Bill[] = [];

function migrateBill(bill: Bill): Bill {
  if (bill.name === 'Rent') {
    return { ...bill, name: 'Rocket Mortgage', amount: 3415, dueDay: 1, note: 'Monthly mortgage payment' };
  }

  if (bill.name === 'Internet' || bill.name === 'Phone') {
    return { ...bill, name: 'Internet & Phone', amount: 115.48, dueDay: 20, category: 'Utilities', autopay: true, note: 'Combined service bill' };
  }

  return bill;
}

const emptyForm = (): BillFormState => ({
  name: '',
  amount: '',
  dueDay: '',
  category: 'Utilities',
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

function exportStateToJson(state: AppState) {
  const payload: BillExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    state,
  };

  return JSON.stringify(payload, null, 2);
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseImportedState(raw: string): AppState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<BillExport> | Partial<AppState> | Bill[];

    if (Array.isArray(parsed)) {
      return { ...defaultState(), bills: parsed };
    }

    if (parsed && typeof parsed === 'object' && 'state' in parsed && parsed.state) {
      const exported = parsed.state as Partial<AppState>;

      return {
        bills: Array.isArray(exported.bills) ? exported.bills : defaultBills,
        budgetTarget: typeof exported.budgetTarget === 'number' ? exported.budgetTarget : defaultState().budgetTarget,
        reminderDays: typeof exported.reminderDays === 'number' ? exported.reminderDays : defaultState().reminderDays,
      };
    }

    const direct = parsed as Partial<AppState>;

    return {
      bills: Array.isArray(direct.bills) ? direct.bills : defaultBills,
      budgetTarget: typeof direct.budgetTarget === 'number' ? direct.budgetTarget : defaultState().budgetTarget,
      reminderDays: typeof direct.reminderDays === 'number' ? direct.reminderDays : defaultState().reminderDays,
    }
  } catch {
    return null;
  }
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function getDaysUntilDue(dueDay: number) {
  const today = new Date();
  const currentDay = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const normalizedDueDay = Math.min(dueDay, daysInMonth);
  return normalizedDueDay >= currentDay ? normalizedDueDay - currentDay : daysInMonth - currentDay + normalizedDueDay;
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

    const upcoming = bills.filter((bill) => bill.status === 'unpaid' && getDaysUntilDue(bill.dueDay) <= reminderDays);

    if (upcoming.length === 0) {
      return;
    }

    upcoming.slice(0, 3).forEach((bill) => {
      new Notification(`${bill.name} is due soon`, {
        body: `${formatCurrency(bill.amount)} is due in ${getDaysUntilDue(bill.dueDay)} day(s).`,
      });
    });

    localStorage.setItem(NOTIFIED_KEY, notificationKey);
  }, [bills, reminderDays]);

  const totals = useMemo(() => {
    const total = bills.reduce((sum, bill) => sum + bill.amount, 0);
    const paid = bills.filter((bill) => bill.status === 'paid').reduce((sum, bill) => sum + bill.amount, 0);
    const unpaid = total - paid;
    const variance = budgetTarget - total;
    const reminderCount = bills.filter((bill) => bill.status === 'unpaid' && getDaysUntilDue(bill.dueDay) <= reminderDays).length;
    const upcoming = [...bills]
      .sort((left, right) => getDaysUntilDue(left.dueDay) - getDaysUntilDue(right.dueDay))
      .slice(0, 3);

    return { total, paid, unpaid, variance, reminderCount, upcoming };
  }, [bills, budgetTarget, reminderDays]);

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
    const dueDay = Number(form.dueDay);

    if (!form.name.trim() || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      return;
    }

    if (editingId) {
      setBills((currentBills) =>
        currentBills.map((bill) =>
          bill.id === editingId
            ? { ...bill, name: form.name.trim(), amount, dueDay, category: form.category, autopay: form.autopay, note: form.note.trim(), url: form.url.trim(), username: form.username.trim(), password: form.password.trim() }
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
          dueDay,
          category: form.category,
          status: 'unpaid',
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
      dueDay: String(bill.dueDay),
      category: bill.category,
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
      currentBills.map((bill) => (bill.id === id ? { ...bill, status: bill.status === 'paid' ? 'unpaid' : 'paid' } : bill)),
    );
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

          <div className="import-export-row">
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
                  <span>{bill.category}</span>
                </div>
                <div>
                  <strong>{formatCurrency(bill.amount)}</strong>
                  <span>Due in {getDaysUntilDue(bill.dueDay)} days</span>
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
                  <span className="pill">{bill.category}</span>
                </div>
                <p>{bill.note || 'No notes yet'}</p>
                <div className="bill-meta">
                  <span>Due day {bill.dueDay}</span>
                  <span>{bill.autopay ? 'Autopay on' : 'Autopay off'}</span>
                  <span>{getDaysUntilDue(bill.dueDay)} days left</span>
                </div>
                {(bill.url || bill.username || bill.password) && (
                  <div className="bill-meta">
                    {bill.url ? <span><a href={bill.url} target="_blank" rel="noreferrer">Open link</a></span> : null}
                    {bill.username ? <span>User: {bill.username}</span> : null}
                    {bill.password ? <span>Pass: {bill.password}</span> : null}
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
                Due day
                <input type="number" min="1" max="31" value={form.dueDay} onChange={(event) => setForm({ ...form, dueDay: event.target.value })} placeholder="15" />
              </label>
            </div>

            <div className="two-col">
              <label>
                Category
                <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                  <option>Housing</option>
                  <option>Utilities</option>
                  <option>Transportation</option>
                  <option>Insurance</option>
                  <option>Entertainment</option>
                  <option>Other</option>
                </select>
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
                <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="password" />
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