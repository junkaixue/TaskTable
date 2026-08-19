package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type Project struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	Deleted bool   `json:"deleted"`
}

type DocTopic struct {
	ID        int    `json:"id"`
	ProjectID int    `json:"project_id"`
	Name      string `json:"name"`
}

type Doc struct {
	ID      int    `json:"id"`
	TopicID int    `json:"topic_id"`
	Name    string `json:"name"`
	URL     string `json:"url"`
}

type Task struct {
	ID           int      `json:"id"`
	Body         string   `json:"body"`
	ProjectID    int      `json:"project_id"`
	FollowUpDate *string  `json:"follow_up_date"`
	DueDate      *string  `json:"due_date"`
	Priority     int      `json:"priority"`
	Tags         []string `json:"tags"`
	URLs         []string `json:"urls"`
	Status       string   `json:"status"`
	CreatedAt    string   `json:"created_at"`
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./tasktable.db")
	if err != nil {
		log.Fatal(err)
	}

	schema := `
	CREATE TABLE IF NOT EXISTS projects (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		deleted INTEGER NOT NULL DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS tasks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		body TEXT NOT NULL,
		project_id INTEGER NOT NULL,
		follow_up_date TEXT,
		due_date TEXT,
		priority INTEGER NOT NULL DEFAULT 3,
		tags TEXT NOT NULL DEFAULT '',
		urls TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL DEFAULT 'pending',
		created_at TEXT NOT NULL,
		FOREIGN KEY (project_id) REFERENCES projects(id)
	);

	CREATE TABLE IF NOT EXISTS doc_topics (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		project_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		UNIQUE(project_id, name),
		FOREIGN KEY (project_id) REFERENCES projects(id)
	);

	CREATE TABLE IF NOT EXISTS docs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		topic_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		url TEXT NOT NULL,
		FOREIGN KEY (topic_id) REFERENCES doc_topics(id)
	);

	INSERT OR IGNORE INTO projects (id, name) VALUES (1, 'Default');
	`
	_, err = db.Exec(schema)
	if err != nil {
		log.Fatal(err)
	}

	// Migration: add columns if they don't exist
	db.Exec("ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 3")
	db.Exec("ALTER TABLE tasks ADD COLUMN tags TEXT NOT NULL DEFAULT ''")
	db.Exec("ALTER TABLE tasks ADD COLUMN urls TEXT NOT NULL DEFAULT ''")
	db.Exec("ALTER TABLE projects ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0")
}

func cors(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func jsonResponse(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func tagsToString(tags []string) string {
	if tags == nil {
		return ""
	}
	trimmed := make([]string, 0, len(tags))
	for _, t := range tags {
		t = strings.TrimSpace(t)
		if t != "" {
			trimmed = append(trimmed, t)
		}
	}
	return strings.Join(trimmed, ",")
}

func stringToTags(s string) []string {
	if s == "" {
		return []string{}
	}
	parts := strings.Split(s, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			result = append(result, p)
		}
	}
	return result
}

func scanTask(scanner interface{ Scan(...interface{}) error }) (Task, error) {
	var t Task
	var tagsStr, urlsStr string
	err := scanner.Scan(&t.ID, &t.Body, &t.ProjectID, &t.FollowUpDate, &t.DueDate, &t.Priority, &tagsStr, &urlsStr, &t.Status, &t.CreatedAt)
	t.Tags = stringToTags(tagsStr)
	t.URLs = stringToTags(urlsStr)
	return t, err
}

const taskColumns = "id, body, project_id, follow_up_date, due_date, priority, tags, urls, status, created_at"

// Projects handlers
func getProjects(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, name, deleted FROM projects ORDER BY id")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	projects := []Project{}
	for rows.Next() {
		var p Project
		rows.Scan(&p.ID, &p.Name, &p.Deleted)
		projects = append(projects, p)
	}
	jsonResponse(w, projects)
}

// deleteProject soft-deletes a project so it no longer appears when creating
// tasks, while preserving the project name for existing (including done) tasks.
func deleteProject(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Invalid project ID", 400)
		return
	}
	if id == 1 {
		http.Error(w, "The Default project cannot be deleted", 400)
		return
	}

	_, err = db.Exec("UPDATE projects SET deleted = 1 WHERE id = ?", id)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	jsonResponse(w, map[string]string{"status": "ok"})
}

func createProject(w http.ResponseWriter, r *http.Request) {
	var p Project
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		http.Error(w, "Invalid request body", 400)
		return
	}
	if p.Name == "" {
		http.Error(w, "Project name is required", 400)
		return
	}

	result, err := db.Exec("INSERT INTO projects (name) VALUES (?)", p.Name)
	if err != nil {
		http.Error(w, "Project name already exists", 409)
		return
	}
	id, _ := result.LastInsertId()
	p.ID = int(id)
	jsonResponse(w, p)
}

// Doc topics handlers
func getDocTopics(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, project_id, name FROM doc_topics ORDER BY project_id, name")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	topics := []DocTopic{}
	for rows.Next() {
		var t DocTopic
		rows.Scan(&t.ID, &t.ProjectID, &t.Name)
		topics = append(topics, t)
	}
	jsonResponse(w, topics)
}

func createDocTopic(w http.ResponseWriter, r *http.Request) {
	var t DocTopic
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		http.Error(w, "Invalid request body", 400)
		return
	}
	t.Name = strings.TrimSpace(t.Name)
	if t.Name == "" {
		http.Error(w, "Topic name is required", 400)
		return
	}
	if t.ProjectID == 0 {
		http.Error(w, "Project is required", 400)
		return
	}

	result, err := db.Exec("INSERT INTO doc_topics (project_id, name) VALUES (?, ?)", t.ProjectID, t.Name)
	if err != nil {
		http.Error(w, "Topic already exists under this project", 409)
		return
	}
	id, _ := result.LastInsertId()
	t.ID = int(id)
	jsonResponse(w, t)
}

func deleteDocTopic(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.URL.Query().Get("id"))
	if err != nil {
		http.Error(w, "Invalid topic ID", 400)
		return
	}
	db.Exec("DELETE FROM docs WHERE topic_id = ?", id)
	if _, err := db.Exec("DELETE FROM doc_topics WHERE id = ?", id); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	jsonResponse(w, map[string]string{"status": "ok"})
}

// Docs handlers
func getDocs(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, topic_id, name, url FROM docs ORDER BY topic_id, name")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	docs := []Doc{}
	for rows.Next() {
		var d Doc
		rows.Scan(&d.ID, &d.TopicID, &d.Name, &d.URL)
		docs = append(docs, d)
	}
	jsonResponse(w, docs)
}

func createDoc(w http.ResponseWriter, r *http.Request) {
	var d Doc
	if err := json.NewDecoder(r.Body).Decode(&d); err != nil {
		http.Error(w, "Invalid request body", 400)
		return
	}
	d.Name = strings.TrimSpace(d.Name)
	d.URL = strings.TrimSpace(d.URL)
	if d.Name == "" || d.URL == "" {
		http.Error(w, "Doc name and URL are required", 400)
		return
	}
	if d.TopicID == 0 {
		http.Error(w, "Topic is required", 400)
		return
	}

	result, err := db.Exec("INSERT INTO docs (topic_id, name, url) VALUES (?, ?, ?)", d.TopicID, d.Name, d.URL)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	id, _ := result.LastInsertId()
	d.ID = int(id)
	jsonResponse(w, d)
}

func updateDoc(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.URL.Query().Get("id"))
	if err != nil {
		http.Error(w, "Invalid doc ID", 400)
		return
	}

	var d Doc
	if err := json.NewDecoder(r.Body).Decode(&d); err != nil {
		http.Error(w, "Invalid request body", 400)
		return
	}
	d.Name = strings.TrimSpace(d.Name)
	d.URL = strings.TrimSpace(d.URL)
	if d.Name == "" || d.URL == "" {
		http.Error(w, "Doc name and URL are required", 400)
		return
	}
	if d.TopicID == 0 {
		http.Error(w, "Topic is required", 400)
		return
	}

	if _, err := db.Exec("UPDATE docs SET topic_id = ?, name = ?, url = ? WHERE id = ?", d.TopicID, d.Name, d.URL, id); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	d.ID = id
	jsonResponse(w, d)
}

func deleteDoc(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.URL.Query().Get("id"))
	if err != nil {
		http.Error(w, "Invalid doc ID", 400)
		return
	}
	if _, err := db.Exec("DELETE FROM docs WHERE id = ?", id); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	jsonResponse(w, map[string]string{"status": "ok"})
}

func buildSearchConditions(r *http.Request) ([]string, []interface{}) {
	conditions := []string{}
	args := []interface{}{}

	if q := r.URL.Query().Get("q"); q != "" {
		conditions = append(conditions, "LOWER(body) LIKE LOWER(?)")
		args = append(args, "%"+q+"%")
	}
	if tag := r.URL.Query().Get("tag"); tag != "" {
		conditions = append(conditions, "(',' || REPLACE(LOWER(tags), ' ', '') || ',') LIKE LOWER(?)")
		args = append(args, "%,"+strings.TrimSpace(tag)+",%")
	}
	if p := r.URL.Query().Get("priority"); p != "" {
		if pVal, err := strconv.Atoi(p); err == nil && pVal >= 0 && pVal <= 5 {
			conditions = append(conditions, "priority = ?")
			args = append(args, pVal)
		}
	}
	if from := r.URL.Query().Get("from"); from != "" {
		conditions = append(conditions, "created_at >= ?")
		args = append(args, from)
	}
	if to := r.URL.Query().Get("to"); to != "" {
		conditions = append(conditions, "created_at <= ?")
		args = append(args, to+"T23:59:59Z")
	}
	return conditions, args
}

// Tasks handlers
func getTasks(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	conditions := []string{}
	args := []interface{}{}

	if status != "" {
		conditions = append(conditions, "status = ?")
		args = append(args, status)
	}

	searchConds, searchArgs := buildSearchConditions(r)
	conditions = append(conditions, searchConds...)
	args = append(args, searchArgs...)

	query := "SELECT " + taskColumns + " FROM tasks"
	if len(conditions) > 0 {
		query += " WHERE " + strings.Join(conditions, " AND ")
	}
	query += " ORDER BY priority ASC, created_at DESC"

	rows, err := db.Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	tasks := []Task{}
	for rows.Next() {
		t, _ := scanTask(rows)
		tasks = append(tasks, t)
	}
	jsonResponse(w, tasks)
}

func getTodayTasks(w http.ResponseWriter, r *http.Request) {
	today := time.Now().Format("2006-01-02")
	fiveDaysLater := time.Now().AddDate(0, 0, 5).Format("2006-01-02")

	conditions := []string{
		"status = 'pending'",
		"(follow_up_date = ? OR (due_date IS NOT NULL AND due_date <= ?))",
	}
	args := []interface{}{today, fiveDaysLater}

	searchConds, searchArgs := buildSearchConditions(r)
	conditions = append(conditions, searchConds...)
	args = append(args, searchArgs...)

	query := "SELECT " + taskColumns + " FROM tasks WHERE " + strings.Join(conditions, " AND ")
	query += " ORDER BY priority ASC, CASE WHEN due_date IS NOT NULL AND due_date <= ? THEN 0 ELSE 1 END, due_date ASC, follow_up_date ASC"
	args = append(args, today)

	rows, err := db.Query(query, args...)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	tasks := []Task{}
	for rows.Next() {
		t, _ := scanTask(rows)
		tasks = append(tasks, t)
	}
	jsonResponse(w, tasks)
}

func createTask(w http.ResponseWriter, r *http.Request) {
	var t Task
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		http.Error(w, "Invalid request body", 400)
		return
	}
	if t.Body == "" {
		http.Error(w, "Task body is required", 400)
		return
	}
	if t.FollowUpDate == nil && t.DueDate == nil {
		http.Error(w, "Either follow_up_date or due_date is required", 400)
		return
	}
	if t.ProjectID == 0 {
		t.ProjectID = 1
	}
	if t.Priority < 0 || t.Priority > 5 {
		t.Priority = 3
	}
	t.Status = "pending"
	t.CreatedAt = time.Now().Format(time.RFC3339)

	result, err := db.Exec(
		"INSERT INTO tasks (body, project_id, follow_up_date, due_date, priority, tags, urls, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		t.Body, t.ProjectID, t.FollowUpDate, t.DueDate, t.Priority, tagsToString(t.Tags), tagsToString(t.URLs), t.Status, t.CreatedAt,
	)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	id, _ := result.LastInsertId()
	t.ID = int(id)
	jsonResponse(w, t)
}

func updateTask(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Invalid task ID", 400)
		return
	}

	var t Task
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		http.Error(w, "Invalid request body", 400)
		return
	}

	if t.Priority < 0 || t.Priority > 5 {
		t.Priority = 3
	}

	_, err = db.Exec(
		"UPDATE tasks SET body = ?, project_id = ?, follow_up_date = ?, due_date = ?, priority = ?, tags = ?, urls = ? WHERE id = ?",
		t.Body, t.ProjectID, t.FollowUpDate, t.DueDate, t.Priority, tagsToString(t.Tags), tagsToString(t.URLs), id,
	)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}

	row := db.QueryRow("SELECT "+taskColumns+" FROM tasks WHERE id = ?", id)
	updated, _ := scanTask(row)
	jsonResponse(w, updated)
}

func markDone(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Invalid task ID", 400)
		return
	}

	_, err = db.Exec("UPDATE tasks SET status = 'done' WHERE id = ?", id)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	jsonResponse(w, map[string]string{"status": "ok"})
}

func deleteTask(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Invalid task ID", 400)
		return
	}

	_, err = db.Exec("DELETE FROM tasks WHERE id = ?", id)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	jsonResponse(w, map[string]string{"status": "ok"})
}

func reopenTask(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Invalid task ID", 400)
		return
	}

	var body struct {
		FollowUpDate *string `json:"follow_up_date"`
		DueDate      *string `json:"due_date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", 400)
		return
	}
	if body.FollowUpDate == nil && body.DueDate == nil {
		http.Error(w, "Either follow_up_date or due_date is required to reopen", 400)
		return
	}

	_, err = db.Exec("UPDATE tasks SET status = 'pending', follow_up_date = ?, due_date = ? WHERE id = ?",
		body.FollowUpDate, body.DueDate, id)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	jsonResponse(w, map[string]string{"status": "ok"})
}

func main() {
	initDB()
	defer db.Close()

	http.HandleFunc("/api/projects", cors(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			getProjects(w, r)
		case "POST":
			createProject(w, r)
		default:
			http.Error(w, "Method not allowed", 405)
		}
	}))

	http.HandleFunc("/api/projects/delete", cors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "DELETE" || r.Method == "OPTIONS" {
			deleteProject(w, r)
		} else {
			http.Error(w, "Method not allowed", 405)
		}
	}))

	http.HandleFunc("/api/tasks", cors(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			getTasks(w, r)
		case "POST":
			createTask(w, r)
		default:
			http.Error(w, "Method not allowed", 405)
		}
	}))

	http.HandleFunc("/api/tasks/today", cors(func(w http.ResponseWriter, r *http.Request) {
		getTodayTasks(w, r)
	}))

	http.HandleFunc("/api/tasks/update", cors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "PUT" || r.Method == "OPTIONS" {
			updateTask(w, r)
		} else {
			http.Error(w, "Method not allowed", 405)
		}
	}))

	http.HandleFunc("/api/tasks/done", cors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "PUT" || r.Method == "OPTIONS" {
			markDone(w, r)
		} else {
			http.Error(w, "Method not allowed", 405)
		}
	}))

	http.HandleFunc("/api/tasks/delete", cors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "DELETE" || r.Method == "OPTIONS" {
			deleteTask(w, r)
		} else {
			http.Error(w, "Method not allowed", 405)
		}
	}))

	http.HandleFunc("/api/tasks/reopen", cors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "PUT" || r.Method == "OPTIONS" {
			reopenTask(w, r)
		} else {
			http.Error(w, "Method not allowed", 405)
		}
	}))

	http.HandleFunc("/api/doc-topics", cors(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			getDocTopics(w, r)
		case "POST":
			createDocTopic(w, r)
		default:
			http.Error(w, "Method not allowed", 405)
		}
	}))

	http.HandleFunc("/api/doc-topics/delete", cors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "DELETE" || r.Method == "OPTIONS" {
			deleteDocTopic(w, r)
		} else {
			http.Error(w, "Method not allowed", 405)
		}
	}))

	http.HandleFunc("/api/docs", cors(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			getDocs(w, r)
		case "POST":
			createDoc(w, r)
		default:
			http.Error(w, "Method not allowed", 405)
		}
	}))

	http.HandleFunc("/api/docs/update", cors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "PUT" || r.Method == "OPTIONS" {
			updateDoc(w, r)
		} else {
			http.Error(w, "Method not allowed", 405)
		}
	}))

	http.HandleFunc("/api/docs/delete", cors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "DELETE" || r.Method == "OPTIONS" {
			deleteDoc(w, r)
		} else {
			http.Error(w, "Method not allowed", 405)
		}
	}))

	fmt.Println("TaskTable backend running on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
