const API = 'http://localhost:8080/api';

let projects = [];
let allTasks = [];

const TAG_COLORS = [
    '#e74c3c', '#3498db', '#27ae60', '#9b59b6', '#f39c12',
    '#1abc9c', '#e67e22', '#2980b9', '#8e44ad', '#16a085',
    '#d35400', '#c0392b', '#2ecc71', '#3498db', '#e91e63'
];

function getTagColor(tag) {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
        hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    }
    return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

async function fetchJSON(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
    }
    return res.json();
}

function buildSearchParams(section) {
    const bar = document.querySelector(`.search-bar[data-section="${section}"]`);
    if (!bar) return '';
    const q = bar.querySelector('.search-q').value.trim();
    const tag = bar.querySelector('.search-tag').value.trim();
    const priority = bar.querySelector('.search-priority').value;
    const from = bar.querySelector('.search-from').value;
    const to = bar.querySelector('.search-to').value;

    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tag) params.set('tag', tag);
    if (priority !== '') params.set('priority', priority);
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    const str = params.toString();
    return str ? '&' + str : '';
}

async function loadProjects() {
    projects = await fetchJSON(`${API}/projects`);
    populateProjectSelect();
}

function populateProjectSelect() {
    const select = document.getElementById('task-project');
    select.innerHTML = projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
}

function getProjectName(id) {
    const p = projects.find(proj => proj.id === id);
    return p ? p.name : 'Default';
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr + 'T00:00:00').toLocaleDateString();
}

const PRIORITY_LABELS = ['0', '1', '2', '3', '4', '5'];

function renderTaskItem(task, showDoneBtn) {
    const today = new Date().toISOString().split('T')[0];
    let dateHtml = '';

    if (task.follow_up_date) {
        dateHtml += `<span>Follow-up: ${formatDate(task.follow_up_date)}</span> `;
    }
    if (task.due_date) {
        if (task.status === 'done') {
            dateHtml += `<span>Due: ${formatDate(task.due_date)}</span>`;
        } else {
            const dueTime = new Date(task.due_date + 'T00:00:00').getTime();
            const todayTime = new Date(today + 'T00:00:00').getTime();
            const daysLeft = Math.ceil((dueTime - todayTime) / 86400000);
            let cls = '';
            let daysText = '';
            if (daysLeft < 0) {
                cls = 'overdue';
                daysText = ` (${Math.abs(daysLeft)}d overdue)`;
            } else if (daysLeft === 0) {
                cls = 'overdue';
                daysText = ' (due today)';
            } else if (daysLeft <= 2) {
                cls = 'due-urgent';
                daysText = ` (${daysLeft}d left)`;
            } else if (daysLeft <= 5) {
                cls = 'due-soon';
                daysText = ` (${daysLeft}d left)`;
            } else {
                daysText = ` (${daysLeft}d left)`;
            }
            dateHtml += `<span class="${cls}">Due: ${formatDate(task.due_date)}${daysText}</span>`;
        }
    }

    const priorityHtml = `<span class="priority-badge priority-${task.priority}">${PRIORITY_LABELS[task.priority]}</span>`;

    let tagsHtml = '';
    if (task.tags && task.tags.length > 0 && task.tags[0] !== '') {
        tagsHtml = task.tags.map(tag =>
            `<span class="tag" style="background:${getTagColor(tag)}" onclick="searchByTag('${escapeHtml(tag.trim())}')">${escapeHtml(tag.trim())}</span>`
        ).join('');
    }

    let urlsHtml = '';
    if (task.urls && task.urls.length > 0 && task.urls[0] !== '') {
        urlsHtml = '<div class="task-urls">' + task.urls.map(entry => {
            const [label, url] = parseUrlEntry(entry);
            return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
        }).join('') + '</div>';
    }

    const editBtn = `<button class="btn btn-edit" onclick="editTask(${task.id})">Edit</button>`;
    const actions = showDoneBtn
        ? `${editBtn}<button class="btn btn-done" onclick="markDone(${task.id})">Done</button>`
        : `${editBtn}<button class="btn btn-reopen" onclick="showReopen(${task.id})">Reopen</button>`;

    return `
        <div class="task-item" data-id="${task.id}">
            ${priorityHtml}
            <div class="task-content">
                <div class="task-body">${escapeHtml(task.body)}</div>
                <div class="task-meta">
                    ${tagsHtml}
                    <span class="task-dates">${dateHtml}</span>
                </div>
                ${urlsHtml}
            </div>
            <div class="task-actions">${actions}</div>
        </div>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function parseUrlEntry(entry) {
    const idx = entry.indexOf('|');
    if (idx > 0) {
        return [entry.substring(0, idx).trim(), entry.substring(idx + 1).trim()];
    }
    return [entry.trim(), entry.trim()];
}

function addUrlRow(label, url) {
    const container = document.getElementById('task-urls-container');
    const row = document.createElement('div');
    row.className = 'url-row';
    row.innerHTML = `
        <input type="text" placeholder="Label" class="url-label" value="${escapeHtml(label || '')}">
        <input type="text" placeholder="https://..." class="url-value" value="${escapeHtml(url || '')}">
        <button type="button" class="btn btn-small btn-remove-url">x</button>
    `;
    row.querySelector('.btn-remove-url').addEventListener('click', () => row.remove());
    container.appendChild(row);
}

function getUrlEntries() {
    const rows = document.querySelectorAll('#task-urls-container .url-row');
    const entries = [];
    rows.forEach(row => {
        const label = row.querySelector('.url-label').value.trim();
        const url = row.querySelector('.url-value').value.trim();
        if (url) {
            entries.push(label ? `${label}|${url}` : url);
        }
    });
    return entries;
}

function groupByProject(tasks) {
    const groups = {};
    tasks.forEach(t => {
        const name = getProjectName(t.project_id);
        if (!groups[name]) groups[name] = [];
        groups[name].push(t);
    });
    return groups;
}

function renderProjectGroups(container, tasks, showDoneBtn) {
    const groups = groupByProject(tasks);
    if (Object.keys(groups).length === 0) {
        container.innerHTML = '<p class="empty-message">No tasks found.</p>';
        return;
    }
    let html = '';
    for (const [projectName, projectTasks] of Object.entries(groups)) {
        html += `<div class="project-group"><h3>${escapeHtml(projectName)}</h3>`;
        html += projectTasks.map(t => renderTaskItem(t, showDoneBtn)).join('');
        html += '</div>';
    }
    container.innerHTML = html;
}

async function loadTodayTasks() {
    const search = buildSearchParams('today');
    const tasks = await fetchJSON(`${API}/tasks/today?_=1${search}`);
    const container = document.getElementById('today-tasks');
    if (tasks.length === 0) {
        container.innerHTML = '<p class="empty-message">Nothing urgent today.</p>';
    } else {
        container.innerHTML = tasks.map(t => renderTaskItem(t, true)).join('');
    }
    return tasks;
}

async function loadPendingTasks() {
    const search = buildSearchParams('pending');
    const tasks = await fetchJSON(`${API}/tasks?status=pending${search}`);
    renderProjectGroups(document.getElementById('pending-tasks'), tasks, true);
    return tasks;
}

async function loadDoneTasks() {
    const search = buildSearchParams('done');
    const tasks = await fetchJSON(`${API}/tasks?status=done${search}`);
    renderProjectGroups(document.getElementById('done-tasks'), tasks, false);
    return tasks;
}

async function loadAll() {
    await loadProjects();
    const [todayTasks, pendingTasks, doneTasks] = await Promise.all([
        loadTodayTasks(), loadPendingTasks(), loadDoneTasks()
    ]);
    allTasks = [...todayTasks, ...pendingTasks, ...doneTasks];
    // Deduplicate by id
    const seen = new Set();
    allTasks = allTasks.filter(t => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
    });
}

async function markDone(id) {
    await fetchJSON(`${API}/tasks/done?id=${id}`, { method: 'PUT' });
    loadAll();
}

function editTask(id) {
    const task = allTasks.find(t => t.id === id);
    if (!task) return;

    document.getElementById('modal-task-title').textContent = 'Edit Task';
    document.getElementById('btn-submit-task').textContent = 'Update Task';
    document.getElementById('task-edit-id').value = id;
    document.getElementById('task-body').value = task.body;
    document.getElementById('task-project').value = task.project_id;
    document.getElementById('task-priority').value = task.priority;
    document.getElementById('task-tags').value = (task.tags && task.tags[0] !== '') ? task.tags.join(', ') : '';
    document.getElementById('task-urls-container').innerHTML = '';
    if (task.urls && task.urls.length > 0 && task.urls[0] !== '') {
        task.urls.forEach(entry => {
            const [label, url] = parseUrlEntry(entry);
            addUrlRow(label, url);
        });
    }
    document.getElementById('task-follow-up').value = task.follow_up_date || '';
    document.getElementById('task-due-date').value = task.due_date || '';
    document.getElementById('modal-task').style.display = 'flex';
}

function showReopen(id) {
    document.getElementById('reopen-task-id').value = id;
    document.getElementById('reopen-follow-up').value = '';
    document.getElementById('reopen-due-date').value = '';
    document.getElementById('modal-reopen').style.display = 'flex';
}

function searchByTag(tag) {
    document.querySelectorAll('.search-bar').forEach(bar => {
        bar.querySelector('.search-q').value = '';
        bar.querySelector('.search-tag').value = tag;
        bar.querySelector('.search-priority').value = '';
        bar.querySelector('.search-from').value = '';
        bar.querySelector('.search-to').value = '';
    });
    Promise.all([loadTodayTasks(), loadPendingTasks(), loadDoneTasks()]);
}

// Search handlers
document.querySelectorAll('.btn-search').forEach(btn => {
    btn.addEventListener('click', () => {
        const section = btn.closest('.search-bar').dataset.section;
        if (section === 'today') loadTodayTasks();
        else if (section === 'pending') loadPendingTasks();
        else if (section === 'done') loadDoneTasks();
    });
});

document.querySelectorAll('.btn-clear-search').forEach(btn => {
    btn.addEventListener('click', () => {
        const bar = btn.closest('.search-bar');
        bar.querySelector('.search-q').value = '';
        bar.querySelector('.search-tag').value = '';
        bar.querySelector('.search-priority').value = '';
        bar.querySelector('.search-from').value = '';
        bar.querySelector('.search-to').value = '';
        const section = bar.dataset.section;
        if (section === 'today') loadTodayTasks();
        else if (section === 'pending') loadPendingTasks();
        else if (section === 'done') loadDoneTasks();
    });
});

// Allow Enter key in search inputs to trigger search
document.querySelectorAll('.search-bar input').forEach(input => {
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.closest('.search-bar').querySelector('.btn-search').click();
        }
    });
});

// Modal handlers
document.getElementById('btn-add-url').addEventListener('click', () => addUrlRow('', ''));

document.getElementById('btn-new-task').addEventListener('click', () => {
    document.getElementById('modal-task-title').textContent = 'New Task';
    document.getElementById('btn-submit-task').textContent = 'Save Task';
    document.getElementById('task-edit-id').value = '';
    document.getElementById('form-task').reset();
    document.getElementById('task-urls-container').innerHTML = '';
    document.getElementById('modal-task').style.display = 'flex';
});

document.getElementById('btn-cancel-task').addEventListener('click', () => {
    document.getElementById('modal-task').style.display = 'none';
});

document.getElementById('btn-new-project').addEventListener('click', () => {
    document.getElementById('form-project').reset();
    document.getElementById('modal-project').style.display = 'flex';
});

document.getElementById('btn-cancel-project').addEventListener('click', () => {
    document.getElementById('modal-project').style.display = 'none';
});

document.getElementById('btn-cancel-reopen').addEventListener('click', () => {
    document.getElementById('modal-reopen').style.display = 'none';
});

// Form submissions
document.getElementById('form-task').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('task-edit-id').value;
    const body = document.getElementById('task-body').value.trim();
    const projectId = parseInt(document.getElementById('task-project').value);
    const priority = parseInt(document.getElementById('task-priority').value);
    const tagsRaw = document.getElementById('task-tags').value.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(t => t) : [];
    const followUp = document.getElementById('task-follow-up').value || null;
    const dueDate = document.getElementById('task-due-date').value || null;

    if (!followUp && !dueDate) {
        alert('Please provide at least a follow-up date or due date.');
        return;
    }

    const urls = getUrlEntries();

    const payload = {
        body: body,
        project_id: projectId,
        priority: priority,
        tags: tags,
        urls: urls,
        follow_up_date: followUp,
        due_date: dueDate
    };

    if (editId) {
        await fetchJSON(`${API}/tasks/update?id=${editId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } else {
        await fetchJSON(`${API}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    document.getElementById('modal-task').style.display = 'none';
    loadAll();
});

document.getElementById('form-project').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('project-name').value.trim();
    if (!name) return;

    await fetchJSON(`${API}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });

    document.getElementById('modal-project').style.display = 'none';
    loadAll();
});

document.getElementById('form-reopen').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('reopen-task-id').value;
    const followUp = document.getElementById('reopen-follow-up').value || null;
    const dueDate = document.getElementById('reopen-due-date').value || null;

    if (!followUp && !dueDate) {
        alert('Please provide at least a follow-up date or due date.');
        return;
    }

    await fetchJSON(`${API}/tasks/reopen?id=${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ follow_up_date: followUp, due_date: dueDate })
    });

    document.getElementById('modal-reopen').style.display = 'none';
    loadAll();
});

// Initial load
loadAll();
