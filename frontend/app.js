const API = 'http://localhost:8080/api';

let projects = [];
let allTasks = [];
let deleteMode = false;
let docTopics = [];
let docs = [];
const docsTreeCollapsed = new Set();

function getTagColor(tag) {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
        hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    }
    // Spread hues with the golden angle so similar tags land far apart,
    // varying saturation/lightness slightly for extra separation.
    const hue = Math.abs(hash * 137.508) % 360;
    const sat = 55 + Math.abs(hash >> 3) % 25;
    const light = 38 + Math.abs(hash >> 6) % 12;
    return `hsl(${hue.toFixed(0)}, ${sat}%, ${light}%)`;
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
    const active = projects.filter(p => !p.deleted);
    select.innerHTML = active.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
}

async function deleteProject(id) {
    const proj = projects.find(p => p.id === id);
    if (!proj) return;
    if (id === 1) {
        alert('The Default project cannot be deleted.');
        return;
    }
    if (!confirm(`Delete project "${proj.name}"? Existing tasks keep this project, but you can no longer assign new tasks to it.`)) return;
    await fetchJSON(`${API}/projects/delete?id=${id}`, { method: 'DELETE' });
    await loadProjects();
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
        if (!showDoneBtn) {
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
    const deleteBtn = deleteMode ? `<button class="btn btn-delete" onclick="deleteTask(${task.id})">Delete</button>` : '';
    const actions = showDoneBtn
        ? `${editBtn}<button class="btn btn-done" onclick="markDone(${task.id})">Done</button>${deleteBtn}`
        : `${editBtn}<button class="btn btn-reopen" onclick="showReopen(${task.id})">Reopen</button>${deleteBtn}`;

    return `
        <div class="task-item" data-id="${task.id}">
            ${priorityHtml}
            <div class="task-content">
                <div class="task-body">${linkify(task.body)}</div>
                <div class="task-meta">
                    ${tagsHtml}
                    <span class="task-dates">${dateHtml}</span>
                    <span class="task-created">Created: ${new Date(task.created_at).toLocaleDateString()}</span>
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

function linkify(text) {
    const escaped = escapeHtml(text);
    return escaped.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?')\]])/g,
        '<a href="$1" target="_blank" rel="noopener">$1</a>');
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

// --- Docs sidebar (tree: project > topic > doc) ---

async function loadDocsTree() {
    [docTopics, docs] = await Promise.all([
        fetchJSON(`${API}/doc-topics`),
        fetchJSON(`${API}/docs`)
    ]);
    renderDocsTree();
}

function docMatchesFilter(d, filter) {
    if (!filter) return true;
    return (d.tags || []).some(tag => tag.toLowerCase().includes(filter));
}

function renderDocsTree() {
    const container = document.getElementById('docs-tree');
    const activeProjects = projects.filter(p => !p.deleted);
    const filter = document.getElementById('docs-tag-filter').value.trim().toLowerCase();

    let html = '';
    activeProjects.forEach(p => {
        let topics = docTopics.filter(t => t.project_id === p.id);
        if (filter) {
            topics = topics.filter(t => docs.some(d => d.topic_id === t.id && docMatchesFilter(d, filter)));
        }
        if (topics.length === 0) return;

        const pKey = `p${p.id}`;
        const pCollapsed = !filter && docsTreeCollapsed.has(pKey);
        html += `<div class="tree-project${pCollapsed ? ' collapsed' : ''}">`;
        html += `<div class="tree-project-name" data-key="${pKey}"><span class="collapse-arrow">&#9660;</span> ${escapeHtml(p.name)}</div>`;
        html += `<div class="tree-children">`;

        topics.forEach(t => {
            const tKey = `t${t.id}`;
            const tCollapsed = !filter && docsTreeCollapsed.has(tKey);
            const topicDocs = docs.filter(d => d.topic_id === t.id && docMatchesFilter(d, filter));
            html += `<div class="tree-topic${tCollapsed ? ' collapsed' : ''}">`;
            html += `<div class="tree-topic-name" data-key="${tKey}"><span class="collapse-arrow">&#9660;</span> ${escapeHtml(t.name)}`;
            html += `<button class="tree-delete" title="Delete topic" onclick="deleteDocTopic(${t.id}, event)">&times;</button></div>`;
            html += `<div class="tree-children">`;
            if (topicDocs.length === 0) {
                html += `<div class="tree-empty">No docs</div>`;
            }
            topicDocs.forEach(d => {
                let docTagsHtml = '';
                if (d.tags && d.tags.length > 0) {
                    docTagsHtml = d.tags.map(tag =>
                        `<span class="tag" style="background:${getTagColor(tag)}" onclick="filterDocsByTag('${escapeHtml(tag)}')">${escapeHtml(tag)}</span>`
                    ).join('');
                }
                html += `<div class="tree-doc">`;
                html += docTagsHtml;
                html += `<a href="${escapeHtml(d.url)}" target="_blank" rel="noopener" title="${escapeHtml(d.url)}">${escapeHtml(d.name)}</a>`;
                html += `<button class="tree-copy" title="Copy link" onclick="copyDocLink(${d.id}, event)">&#x2398;</button>`;
                html += `<button class="tree-edit" title="Edit doc" onclick="editDoc(${d.id}, event)">&#9998;</button>`;
                html += `<button class="tree-delete" title="Delete doc" onclick="deleteDoc(${d.id}, event)">&times;</button>`;
                html += `</div>`;
            });
            html += `</div></div>`;
        });

        html += `</div></div>`;
    });

    container.innerHTML = html || (filter
        ? '<p class="empty-message">No docs match this tag.</p>'
        : '<p class="empty-message">No docs yet. Add a topic to get started.</p>');
    document.getElementById('btn-clear-doc-filter').style.display = filter ? '' : 'none';

    container.querySelectorAll('.tree-project-name, .tree-topic-name').forEach(el => {
        el.addEventListener('click', () => {
            const key = el.dataset.key;
            if (docsTreeCollapsed.has(key)) docsTreeCollapsed.delete(key);
            else docsTreeCollapsed.add(key);
            el.parentElement.classList.toggle('collapsed');
        });
    });
}

async function deleteDocTopic(id, event) {
    event.stopPropagation();
    const topic = docTopics.find(t => t.id === id);
    const count = docs.filter(d => d.topic_id === id).length;
    if (!confirm(`Delete topic "${topic ? topic.name : id}"${count ? ` and its ${count} doc${count > 1 ? 's' : ''}` : ''}?`)) return;
    await fetchJSON(`${API}/doc-topics/delete?id=${id}`, { method: 'DELETE' });
    loadDocsTree();
}

function filterDocsByTag(tag) {
    document.getElementById('docs-tag-filter').value = tag;
    renderDocsTree();
}

async function copyDocLink(id, event) {
    event.stopPropagation();
    const btn = event.currentTarget;
    const doc = docs.find(d => d.id === id);
    if (!doc) return;

    try {
        await navigator.clipboard.writeText(doc.url);
    } catch (err) {
        // Fallback for contexts where the Clipboard API is unavailable
        const ta = document.createElement('textarea');
        ta.value = doc.url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }

    const original = btn.innerHTML;
    btn.innerHTML = '&#10003;';
    btn.classList.add('copied');
    setTimeout(() => {
        btn.innerHTML = original;
        btn.classList.remove('copied');
    }, 1200);
}

function editDoc(id, event) {
    event.stopPropagation();
    const doc = docs.find(d => d.id === id);
    if (!doc) return;
    const topic = docTopics.find(t => t.id === doc.topic_id);

    document.getElementById('modal-doc-title').textContent = 'Edit Doc';
    document.getElementById('btn-submit-doc').textContent = 'Update Doc';
    document.getElementById('doc-edit-id').value = id;
    populateDocProjectSelect('doc-project', true);
    if (topic) document.getElementById('doc-project').value = topic.project_id;
    populateDocTopicSelect();
    document.getElementById('doc-topic').value = doc.topic_id;
    document.getElementById('doc-name').value = doc.name;
    document.getElementById('doc-url').value = doc.url;
    document.getElementById('doc-tags').value = (doc.tags || []).join(', ');
    document.getElementById('modal-doc').style.display = 'flex';
}

async function deleteDoc(id, event) {
    event.stopPropagation();
    if (!confirm('Delete this doc link?')) return;
    await fetchJSON(`${API}/docs/delete?id=${id}`, { method: 'DELETE' });
    loadDocsTree();
}

function populateDocProjectSelect(selectId, onlyWithTopics) {
    const select = document.getElementById(selectId);
    let active = projects.filter(p => !p.deleted);
    if (onlyWithTopics) {
        active = active.filter(p => docTopics.some(t => t.project_id === p.id));
    }
    select.innerHTML = active.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
}

function populateDocTopicSelect() {
    const projectId = parseInt(document.getElementById('doc-project').value);
    const select = document.getElementById('doc-topic');
    const topics = docTopics.filter(t => t.project_id === projectId);
    select.innerHTML = topics.length
        ? topics.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('')
        : '<option value="">No topics — create one first</option>';
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

function renderProjectGroups(container, tasks, showDoneBtn, defaultCollapsed) {
    const groups = groupByProject(tasks);
    if (Object.keys(groups).length === 0) {
        container.innerHTML = '<p class="empty-message">No tasks found.</p>';
        return;
    }
    let html = '<div class="collapse-all-controls"><button class="btn btn-small btn-collapse-all">Collapse All</button><button class="btn btn-small btn-expand-all">Expand All</button></div>';
    for (const [projectName, projectTasks] of Object.entries(groups)) {
        html += `<div class="project-group${defaultCollapsed ? ' collapsed' : ''}">`;
        html += `<h3 class="project-header"><span class="collapse-arrow">&#9660;</span> ${escapeHtml(projectName)}</h3>`;
        html += `<div class="project-tasks">`;
        html += projectTasks.map(t => renderTaskItem(t, showDoneBtn)).join('');
        html += '</div></div>';
    }
    container.innerHTML = html;

    // Toggle individual project groups
    container.querySelectorAll('.project-header').forEach(header => {
        header.addEventListener('click', () => {
            const group = header.closest('.project-group');
            group.classList.toggle('collapsed');
        });
    });

    // Collapse All
    container.querySelector('.btn-collapse-all').addEventListener('click', () => {
        container.querySelectorAll('.project-group').forEach(g => g.classList.add('collapsed'));
    });

    // Expand All
    container.querySelector('.btn-expand-all').addEventListener('click', () => {
        container.querySelectorAll('.project-group').forEach(g => g.classList.remove('collapsed'));
    });
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
    renderProjectGroups(document.getElementById('done-tasks'), tasks, false, true);
    return tasks;
}

async function loadAll() {
    await loadProjects();
    const [todayTasks, pendingTasks, doneTasks] = await Promise.all([
        loadTodayTasks(), loadPendingTasks(), loadDoneTasks(), loadDocsTree()
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

async function deleteTask(id) {
    if (!confirm('Are you sure you want to delete this task? This cannot be undone.')) return;
    await fetchJSON(`${API}/tasks/delete?id=${id}`, { method: 'DELETE' });
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

document.getElementById('btn-delete-mode').addEventListener('click', () => {
    deleteMode = !deleteMode;
    const btn = document.getElementById('btn-delete-mode');
    btn.classList.toggle('active', deleteMode);
    btn.textContent = deleteMode ? 'Exit Delete Mode' : 'Delete Mode';
    loadAll();
});

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

document.getElementById('btn-delete-project').addEventListener('click', async () => {
    const id = parseInt(document.getElementById('task-project').value);
    if (!id) return;
    await deleteProject(id);
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

// Docs modals
document.getElementById('btn-new-topic').addEventListener('click', () => {
    document.getElementById('form-topic').reset();
    populateDocProjectSelect('topic-project');
    document.getElementById('modal-topic').style.display = 'flex';
});

document.getElementById('btn-cancel-topic').addEventListener('click', () => {
    document.getElementById('modal-topic').style.display = 'none';
});

document.getElementById('btn-new-doc').addEventListener('click', () => {
    if (docTopics.length === 0) {
        alert('Create a topic first (+ Topic).');
        return;
    }
    document.getElementById('form-doc').reset();
    document.getElementById('modal-doc-title').textContent = 'New Doc';
    document.getElementById('btn-submit-doc').textContent = 'Add Doc';
    document.getElementById('doc-edit-id').value = '';
    populateDocProjectSelect('doc-project', true);
    populateDocTopicSelect();
    document.getElementById('modal-doc').style.display = 'flex';
});

document.getElementById('doc-project').addEventListener('change', populateDocTopicSelect);

document.getElementById('docs-tag-filter').addEventListener('input', renderDocsTree);

document.getElementById('btn-clear-doc-filter').addEventListener('click', () => {
    document.getElementById('docs-tag-filter').value = '';
    renderDocsTree();
});

document.getElementById('btn-cancel-doc').addEventListener('click', () => {
    document.getElementById('modal-doc').style.display = 'none';
});

document.getElementById('form-topic').addEventListener('submit', async (e) => {
    e.preventDefault();
    const projectId = parseInt(document.getElementById('topic-project').value);
    const name = document.getElementById('topic-name').value.trim();
    if (!name || !projectId) return;

    try {
        await fetchJSON(`${API}/doc-topics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project_id: projectId, name })
        });
    } catch (err) {
        alert(err.message);
        return;
    }

    document.getElementById('modal-topic').style.display = 'none';
    loadDocsTree();
});

document.getElementById('form-doc').addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('doc-edit-id').value;
    const topicId = parseInt(document.getElementById('doc-topic').value);
    const name = document.getElementById('doc-name').value.trim();
    const url = document.getElementById('doc-url').value.trim();
    const tagsRaw = document.getElementById('doc-tags').value.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(t => t) : [];
    if (!topicId) {
        alert('Please pick a topic (create one first if the project has none).');
        return;
    }
    if (!name || !url) return;

    const payload = JSON.stringify({ topic_id: topicId, name, url, tags });
    if (editId) {
        await fetchJSON(`${API}/docs/update?id=${editId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: payload
        });
    } else {
        await fetchJSON(`${API}/docs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload
        });
    }

    document.getElementById('modal-doc').style.display = 'none';
    loadDocsTree();
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

// Summarize done tasks
document.getElementById('btn-summarize').addEventListener('click', () => {
    const doneTasks = allTasks.filter(t => t.status === 'done');
    const summaryDiv = document.getElementById('done-summary');

    if (doneTasks.length === 0) {
        summaryDiv.innerHTML = '<p>No done tasks to summarize.</p>';
        summaryDiv.style.display = 'block';
        return;
    }

    // Group by project
    const byProject = {};
    doneTasks.forEach(t => {
        const name = getProjectName(t.project_id);
        if (!byProject[name]) byProject[name] = [];
        byProject[name].push(t);
    });

    // Collect all tags
    const tagCounts = {};
    doneTasks.forEach(t => {
        if (t.tags && t.tags.length > 0 && t.tags[0] !== '') {
            t.tags.forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
        }
    });

    let html = `<h3>Summary (${doneTasks.length} tasks completed)</h3>`;

    // By project
    html += '<div class="summary-section"><strong>By Project:</strong><ul>';
    for (const [proj, tasks] of Object.entries(byProject)) {
        html += `<li>${escapeHtml(proj)}: ${tasks.length} task${tasks.length > 1 ? 's' : ''}</li>`;
    }
    html += '</ul></div>';

    // By tag
    if (Object.keys(tagCounts).length > 0) {
        html += '<div class="summary-section"><strong>By Tag:</strong><ul>';
        const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
        for (const [tag, count] of sorted) {
            html += `<li><span class="tag" style="background:${getTagColor(tag)}">${escapeHtml(tag)}</span>: ${count}</li>`;
        }
        html += '</ul></div>';
    }

    // Task list
    html += '<div class="summary-section"><strong>Completed:</strong><ul>';
    for (const [proj, tasks] of Object.entries(byProject)) {
        tasks.forEach(t => {
            html += `<li><em>[${escapeHtml(proj)}]</em> ${escapeHtml(t.body)}</li>`;
        });
    }
    html += '</ul></div>';

    // Performance Review Report (exclude personal tasks)
    const reviewTasks = doneTasks.filter(t => {
        if (!t.tags || t.tags.length === 0 || t.tags[0] === '') return true;
        return !t.tags.some(tag => tag.toLowerCase() === 'personal');
    });

    const reviewByProject = {};
    reviewTasks.forEach(t => {
        const name = getProjectName(t.project_id);
        if (!reviewByProject[name]) reviewByProject[name] = [];
        reviewByProject[name].push(t);
    });

    const reviewTagCounts = {};
    reviewTasks.forEach(t => {
        if (t.tags && t.tags.length > 0 && t.tags[0] !== '') {
            t.tags.forEach(tag => {
                reviewTagCounts[tag] = (reviewTagCounts[tag] || 0) + 1;
            });
        }
    });

    html += '<div class="summary-section perf-review">';
    html += '<strong>Performance Review Report</strong>';
    html += '<div class="perf-review-content">';

    // Determine date range
    const dates = reviewTasks.map(t => t.created_at.split('T')[0]).sort();
    const earliest = dates[0];
    const latest = dates[dates.length - 1];
    html += `<p><em>Period: ${formatDate(earliest)} – ${formatDate(latest)}</em></p>`;

    // Key accomplishments by project
    html += '<p><strong>Key Accomplishments:</strong></p><ul>';
    for (const [proj, tasks] of Object.entries(reviewByProject)) {
        if (tasks.length >= 3) {
            html += `<li>Delivered ${tasks.length} tasks for <strong>${escapeHtml(proj)}</strong>, demonstrating consistent output and ownership.</li>`;
        } else {
            html += `<li>Completed ${tasks.length} task${tasks.length > 1 ? 's' : ''} for <strong>${escapeHtml(proj)}</strong>.</li>`;
        }
    }
    html += '</ul>';

    // Areas of focus (top tags)
    if (Object.keys(reviewTagCounts).length > 0) {
        const topTags = Object.entries(reviewTagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
        html += '<p><strong>Areas of Focus:</strong></p><ul>';
        topTags.forEach(([tag, count]) => {
            html += `<li>${escapeHtml(tag)} – ${count} task${count > 1 ? 's' : ''}</li>`;
        });
        html += '</ul>';
    }

    // Impact metrics
    const totalProjects = Object.keys(reviewByProject).length;
    const totalTags = Object.keys(reviewTagCounts).length;
    const highPriority = reviewTasks.filter(t => t.priority <= 1).length;
    html += '<p><strong>Impact Metrics:</strong></p><ul>';
    html += `<li>Total tasks completed: <strong>${reviewTasks.length}</strong></li>`;
    html += `<li>Projects contributed to: <strong>${totalProjects}</strong></li>`;
    if (highPriority > 0) {
        html += `<li>High-priority tasks resolved (P0–P1): <strong>${highPriority}</strong></li>`;
    }
    if (totalTags > 0) {
        html += `<li>Breadth of work (distinct areas): <strong>${totalTags}</strong></li>`;
    }
    html += '</ul>';

    // Narrative summary by project
    html += '<p><strong>Summary of Contributions:</strong></p>';
    for (const [proj, tasks] of Object.entries(reviewByProject)) {
        const highP = tasks.filter(t => t.priority <= 1);
        const taskTags = {};
        tasks.forEach(t => {
            if (t.tags && t.tags.length > 0 && t.tags[0] !== '') {
                t.tags.forEach(tag => { taskTags[tag] = (taskTags[tag] || 0) + 1; });
            }
        });
        const topAreas = Object.entries(taskTags).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);

        let narrative = `<p><strong>${escapeHtml(proj)}</strong>: Completed ${tasks.length} task${tasks.length > 1 ? 's' : ''}`;
        if (topAreas.length > 0) {
            narrative += ` spanning ${topAreas.map(t => escapeHtml(t)).join(', ')}`;
        }
        narrative += '.';
        if (highP.length > 0) {
            narrative += ` Resolved ${highP.length} high-priority item${highP.length > 1 ? 's' : ''} including: ${highP.map(t => escapeHtml(t.body)).join('; ')}.`;
        }
        // Summarize the rest as themes rather than listing each
        const nonHigh = tasks.filter(t => t.priority > 1);
        if (nonHigh.length > 0) {
            // Group by first tag to create thematic sentences
            const themed = {};
            nonHigh.forEach(t => {
                const key = (t.tags && t.tags.length > 0 && t.tags[0] !== '') ? t.tags[0] : '_general';
                if (!themed[key]) themed[key] = [];
                themed[key].push(t.body);
            });
            const themeSentences = [];
            for (const [theme, bodies] of Object.entries(themed)) {
                if (theme === '_general') {
                    if (bodies.length <= 2) {
                        themeSentences.push(bodies.join('; '));
                    } else {
                        themeSentences.push(`${bodies.length} general tasks`);
                    }
                } else {
                    if (bodies.length === 1) {
                        themeSentences.push(`${escapeHtml(theme)}: ${escapeHtml(bodies[0])}`);
                    } else {
                        themeSentences.push(`${bodies.length} tasks in ${escapeHtml(theme)}`);
                    }
                }
            }
            narrative += ` Additional work: ${themeSentences.join('; ')}.`;
        }
        narrative += '</p>';
        html += narrative;
    }

    html += '</div></div>';

    html += '<button class="btn btn-small" onclick="document.getElementById(\'done-summary\').style.display=\'none\'">Close</button>';
    summaryDiv.innerHTML = html;
    summaryDiv.style.display = 'block';
});

// Auto-refresh when switching back to this tab
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        loadAll();
    }
});

// Initial load
loadAll();
