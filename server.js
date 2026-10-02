const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();

const PORT = 5000;
const JWT_SECRET = "taskflow_secret_key_2026";

// ==========================================
// MIDDLEWARE
// ==========================================

app.use(cors());

app.use(
    express.json({
        limit: "10mb"
    })
);

app.use(express.static(path.join(__dirname, "public")));

// ==========================================
// DATABASE
// ==========================================

const dbPath = path.join(
    __dirname,
    "data",
    "database.json"
);

function ensureDatabase() {
    const dataDirectory = path.dirname(dbPath);

    if (!fs.existsSync(dataDirectory)) {
        fs.mkdirSync(dataDirectory, {
            recursive: true
        });
    }

    if (!fs.existsSync(dbPath)) {
        const initialDatabase = {
            users: [],
            projects: [],
            tasks: [],
            comments: []
        };

        fs.writeFileSync(
            dbPath,
            JSON.stringify(initialDatabase, null, 2)
        );
    }
}

function readDatabase() {
    ensureDatabase();

    const data = fs.readFileSync(
        dbPath,
        "utf8"
    );

    const database = JSON.parse(data);

    if (!Array.isArray(database.users)) {
        database.users = [];
    }

    if (!Array.isArray(database.projects)) {
        database.projects = [];
    }

    if (!Array.isArray(database.tasks)) {
        database.tasks = [];
    }

    if (!Array.isArray(database.comments)) {
        database.comments = [];
    }

    return database;
}

function saveDatabase(data) {
    ensureDatabase();

    fs.writeFileSync(
        dbPath,
        JSON.stringify(data, null, 2)
    );
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function createId() {
    return (
        Date.now().toString() +
        Math.random()
            .toString(36)
            .substring(2, 8)
    );
}

function normalizeStatus(status) {
    const allowedStatuses = [
        "todo",
        "in-progress",
        "completed"
    ];

    return allowedStatuses.includes(status)
        ? status
        : "todo";
}

function normalizePriority(priority) {
    const allowedPriorities = [
        "low",
        "medium",
        "high"
    ];

    return allowedPriorities.includes(priority)
        ? priority
        : "medium";
}

function isTaskOverdue(task) {
    if (!task.dueDate) {
        return false;
    }

    if (task.status === "completed") {
        return false;
    }

    const today = new Date();
    const dueDate = new Date(task.dueDate);

    today.setHours(0, 0, 0, 0);
    dueDate.setHours(0, 0, 0, 0);

    return dueDate < today;
}

function calculateProjectProgress(
    tasks
) {
    if (!tasks || tasks.length === 0) {
        return 0;
    }

    const completedTasks =
        tasks.filter(
            task =>
                task.status === "completed"
        ).length;

    return Math.round(
        (completedTasks / tasks.length) * 100
    );
}

function enrichTask(task, database) {
    const assignedUser =
        database.users.find(
            user =>
                user.id === task.assignedTo
        );

    return {
        ...task,

        priority:
            normalizePriority(
                task.priority
            ),

        dueDate:
            task.dueDate || "",

        assignedTo:
            task.assignedTo ||
            task.ownerId,

        assignedUserName:
            assignedUser
                ? assignedUser.name
                : "",

        overdue:
            isTaskOverdue(task)
    };
}

// ==========================================
// SERVER STATUS
// ==========================================

app.get(
    "/api/status",
    (req, res) => {
        res.json({
            success: true,
            message:
                "TaskFlow Project Management Tool API is running!",
            version: "2.0"
        });
    }
);

// ==========================================
// GET DATABASE
// ==========================================

app.get(
    "/api/database",
    (req, res) => {
        try {
            const database =
                readDatabase();

            const projects =
                database.projects.map(
                    project => {
                        const projectTasks =
                            database.tasks.filter(
                                task =>
                                    task.projectId ===
                                    project.id
                            );

                        return {
                            ...project,

                            taskCount:
                                projectTasks.length,

                            completedTasks:
                                projectTasks.filter(
                                    task =>
                                        task.status ===
                                        "completed"
                                ).length,

                            inProgressTasks:
                                projectTasks.filter(
                                    task =>
                                        task.status ===
                                        "in-progress"
                                ).length,

                            todoTasks:
                                projectTasks.filter(
                                    task =>
                                        task.status ===
                                        "todo"
                                ).length,

                            overdueTasks:
                                projectTasks.filter(
                                    task =>
                                        isTaskOverdue(
                                            task
                                        )
                                ).length,

                            progress:
                                calculateProjectProgress(
                                    projectTasks
                                )
                        };
                    }
                );

            const tasks =
                database.tasks.map(
                    task =>
                        enrichTask(
                            task,
                            database
                        )
                );

            res.json({
                ...database,
                projects,
                tasks
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to read database."
            });
        }
    }
);

// ==========================================
// REGISTER
// ==========================================

app.post(
    "/api/auth/register",
    async (req, res) => {
        try {
            const {
                name,
                email,
                password
            } = req.body;

            if (
                !name ||
                !email ||
                !password
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Please fill all fields."
                });
            }

            if (password.length < 6) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Password must be at least 6 characters."
                });
            }

            const database =
                readDatabase();

            const cleanEmail =
                email
                    .toLowerCase()
                    .trim();

            const existingUser =
                database.users.find(
                    user =>
                        user.email ===
                        cleanEmail
                );

            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Email is already registered."
                });
            }

            const hashedPassword =
                await bcrypt.hash(
                    password,
                    10
                );

            const newUser = {
                id: createId(),

                name: name.trim(),

                email: cleanEmail,

                password: hashedPassword,

                createdAt:
                    new Date().toISOString()
            };

            database.users.push(
                newUser
            );

            saveDatabase(database);

            res.status(201).json({
                success: true,
                message:
                    "Account created successfully!"
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Server error."
            });
        }
    }
);

// ==========================================
// LOGIN
// ==========================================

app.post(
    "/api/auth/login",
    async (req, res) => {
        try {
            const {
                email,
                password
            } = req.body;

            if (
                !email ||
                !password
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Please enter email and password."
                });
            }

            const database =
                readDatabase();

            const cleanEmail =
                email
                    .toLowerCase()
                    .trim();

            const user =
                database.users.find(
                    user =>
                        user.email ===
                        cleanEmail
                );

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Invalid email or password."
                });
            }

            const passwordMatch =
                await bcrypt.compare(
                    password,
                    user.password
                );

            if (!passwordMatch) {
                return res.status(401).json({
                    success: false,
                    message:
                        "Invalid email or password."
                });
            }

            const token =
                jwt.sign(
                    {
                        id: user.id,
                        email: user.email
                    },
                    JWT_SECRET,
                    {
                        expiresIn: "24h"
                    }
                );

            res.json({
                success: true,
                message:
                    "Login successful!",

                token,

                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email
                }
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Server error."
            });
        }
    }
);

// ==========================================
// CREATE PROJECT
// ==========================================

app.post(
    "/api/projects",
    (req, res) => {
        try {
            const {
                name,
                description,
                ownerId
            } = req.body;

            if (
                !name ||
                !ownerId
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Project name is required."
                });
            }

            const database =
                readDatabase();

            const owner =
                database.users.find(
                    user =>
                        user.id === ownerId
                );

            if (!owner) {
                return res.status(404).json({
                    success: false,
                    message:
                        "User not found."
                });
            }

            const newProject = {
                id: createId(),

                name: name.trim(),

                description:
                    description
                        ? description.trim()
                        : "",

                ownerId,

                createdAt:
                    new Date().toISOString()
            };

            database.projects.push(
                newProject
            );

            saveDatabase(database);

            res.status(201).json({
                success: true,

                message:
                    "Project created successfully!",

                project: newProject
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to create project."
            });
        }
    }
);

// ==========================================
// DELETE PROJECT
// ==========================================

app.delete(
    "/api/projects/:id",
    (req, res) => {
        try {
            const projectId =
                req.params.id;

            const database =
                readDatabase();

            const projectIndex =
                database.projects.findIndex(
                    project =>
                        project.id ===
                        projectId
                );

            if (projectIndex === -1) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Project not found."
                });
            }

            const project =
                database.projects[
                    projectIndex
                ];

            const projectTasks =
                database.tasks.filter(
                    task =>
                        task.projectId ===
                        projectId
                );

            const taskIds =
                projectTasks.map(
                    task => task.id
                );

            database.projects.splice(
                projectIndex,
                1
            );

            database.tasks =
                database.tasks.filter(
                    task =>
                        task.projectId !==
                        projectId
                );

            database.comments =
                database.comments.filter(
                    comment =>
                        !taskIds.includes(
                            comment.taskId
                        )
                );

            saveDatabase(database);

            console.log(
                "Project deleted:",
                project.name
            );

            res.json({
                success: true,
                message:
                    "Project deleted successfully."
            });
        } catch (error) {
            console.error(
                "DELETE PROJECT ERROR:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to delete project."
            });
        }
    }
);

// ==========================================
// GET SINGLE PROJECT
// ==========================================

app.get(
    "/api/projects/:id",
    (req, res) => {
        try {
            const projectId =
                req.params.id;

            const database =
                readDatabase();

            const project =
                database.projects.find(
                    project =>
                        project.id ===
                        projectId
                );

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Project not found."
                });
            }

            const tasks =
                database.tasks
                    .filter(
                        task =>
                            task.projectId ===
                            projectId
                    )
                    .map(
                        task =>
                            enrichTask(
                                task,
                                database
                            )
                    );

            const progress =
                calculateProjectProgress(
                    tasks
                );

            res.json({
                success: true,

                project: {
                    ...project,

                    taskCount:
                        tasks.length,

                    completedTasks:
                        tasks.filter(
                            task =>
                                task.status ===
                                "completed"
                        ).length,

                    inProgressTasks:
                        tasks.filter(
                            task =>
                                task.status ===
                                "in-progress"
                        ).length,

                    todoTasks:
                        tasks.filter(
                            task =>
                                task.status ===
                                "todo"
                        ).length,

                    overdueTasks:
                        tasks.filter(
                            task =>
                                task.overdue
                        ).length,

                    progress
                },

                tasks
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to load project."
            });
        }
    }
);

// ==========================================
// CREATE TASK
// ==========================================

app.post(
    "/api/tasks",
    (req, res) => {
        try {
            const {
                name,
                description,
                status,
                priority,
                dueDate,
                assignedTo,
                projectId,
                ownerId
            } = req.body;

            if (
                !name ||
                !projectId ||
                !ownerId
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Task name, project and owner are required."
                });
            }

            const database =
                readDatabase();

            const project =
                database.projects.find(
                    project =>
                        project.id ===
                        projectId
                );

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Project not found."
                });
            }

            if (
                project.ownerId !==
                ownerId
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to add tasks to this project."
                });
            }

            const taskStatus =
                normalizeStatus(
                    status
                );

            const taskPriority =
                normalizePriority(
                    priority
                );

            const newTask = {
                id: createId(),

                name: name.trim(),

                description:
                    description
                        ? description.trim()
                        : "",

                status:
                    taskStatus,

                priority:
                    taskPriority,

                dueDate:
                    dueDate || "",

                assignedTo:
                    assignedTo ||
                    ownerId,

                projectId,

                ownerId,

                createdAt:
                    new Date().toISOString(),

                updatedAt:
                    new Date().toISOString()
            };

            database.tasks.push(
                newTask
            );

            saveDatabase(database);

            res.status(201).json({
                success: true,

                message:
                    "Task created successfully!",

                task:
                    enrichTask(
                        newTask,
                        database
                    )
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to create task."
            });
        }
    }
);

// ==========================================
// EDIT TASK
// ==========================================

app.put(
    "/api/tasks/:id",
    (req, res) => {
        try {
            const taskId =
                req.params.id;

            const {
                name,
                description,
                status,
                priority,
                dueDate,
                assignedTo,
                ownerId
            } = req.body;

            if (
                !name ||
                !ownerId
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Task name is required."
                });
            }

            const database =
                readDatabase();

            const task =
                database.tasks.find(
                    task =>
                        task.id ===
                        taskId
                );

            if (!task) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Task not found."
                });
            }

            if (
                task.ownerId !==
                ownerId
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to edit this task."
                });
            }

            task.name =
                name.trim();

            task.description =
                description
                    ? description.trim()
                    : "";

            task.status =
                normalizeStatus(
                    status
                );

            task.priority =
                normalizePriority(
                    priority
                );

            task.dueDate =
                dueDate || "";

            task.assignedTo =
                assignedTo ||
                task.ownerId;

            task.updatedAt =
                new Date().toISOString();

            saveDatabase(database);

            res.json({
                success: true,

                message:
                    "Task updated successfully!",

                task:
                    enrichTask(
                        task,
                        database
                    )
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to update task."
            });
        }
    }
);

// ==========================================
// DELETE TASK
// ==========================================

app.delete(
    "/api/tasks/:id",
    (req, res) => {
        try {
            const taskId =
                req.params.id;

            const database =
                readDatabase();

            const taskIndex =
                database.tasks.findIndex(
                    task =>
                        task.id ===
                        taskId
                );

            if (taskIndex === -1) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Task not found."
                });
            }

            database.tasks.splice(
                taskIndex,
                1
            );

            database.comments =
                database.comments.filter(
                    comment =>
                        comment.taskId !==
                        taskId
                );

            saveDatabase(database);

            res.json({
                success: true,
                message:
                    "Task deleted successfully."
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to delete task."
            });
        }
    }
);

// ==========================================
// UPDATE TASK STATUS ONLY
// ==========================================

app.patch(
    "/api/tasks/:id/status",
    (req, res) => {
        try {
            const taskId =
                req.params.id;

            const {
                status,
                ownerId
            } = req.body;

            const database =
                readDatabase();

            const task =
                database.tasks.find(
                    task =>
                        task.id ===
                        taskId
                );

            if (!task) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Task not found."
                });
            }

            if (
                ownerId &&
                task.ownerId !==
                    ownerId
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "You do not have permission to update this task."
                });
            }

            task.status =
                normalizeStatus(
                    status
                );

            task.updatedAt =
                new Date().toISOString();

            saveDatabase(database);

            res.json({
                success: true,

                message:
                    "Task status updated!",

                task:
                    enrichTask(
                        task,
                        database
                    )
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to update task status."
            });
        }
    }
);

// ==========================================
// ADD COMMENT
// ==========================================

app.post(
    "/api/comments",
    (req, res) => {
        try {
            const {
                text,
                taskId,
                userId
            } = req.body;

            if (
                !text ||
                !taskId ||
                !userId
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Comment, task and user are required."
                });
            }

            const database =
                readDatabase();

            const task =
                database.tasks.find(
                    task =>
                        task.id ===
                        taskId
                );

            if (!task) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Task not found."
                });
            }

            const user =
                database.users.find(
                    user =>
                        user.id ===
                        userId
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "User not found."
                });
            }

            const newComment = {
                id: createId(),

                text: text.trim(),

                taskId,

                userId,

                userName:
                    user.name,

                createdAt:
                    new Date().toISOString()
            };

            database.comments.push(
                newComment
            );

            saveDatabase(database);

            res.status(201).json({
                success: true,

                message:
                    "Comment added successfully!",

                comment:
                    newComment
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to add comment."
            });
        }
    }
);

// ==========================================
// DELETE COMMENT
// ==========================================

app.delete(
    "/api/comments/:id",
    (req, res) => {
        try {
            const commentId =
                req.params.id;

            const database =
                readDatabase();

            const commentIndex =
                database.comments.findIndex(
                    comment =>
                        comment.id ===
                        commentId
                );

            if (commentIndex === -1) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Comment not found."
                });
            }

            database.comments.splice(
                commentIndex,
                1
            );

            saveDatabase(database);

            res.json({
                success: true,
                message:
                    "Comment deleted successfully."
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to delete comment."
            });
        }
    }
);

// ==========================================
// SEARCH TASKS
// ==========================================

app.get(
    "/api/tasks/search",
    (req, res) => {
        try {
            const {
                q = "",
                status = "",
                priority = "",
                projectId = ""
            } = req.query;

            const database =
                readDatabase();

            let tasks =
                database.tasks.map(
                    task =>
                        enrichTask(
                            task,
                            database
                        )
                );

            if (q.trim()) {
                const search =
                    q
                        .toLowerCase()
                        .trim();

                tasks =
                    tasks.filter(
                        task =>
                            task.name
                                .toLowerCase()
                                .includes(search) ||

                            task.description
                                .toLowerCase()
                                .includes(search)
                    );
            }

            if (status) {
                tasks =
                    tasks.filter(
                        task =>
                            task.status ===
                            status
                    );
            }

            if (priority) {
                tasks =
                    tasks.filter(
                        task =>
                            task.priority ===
                            priority
                    );
            }

            if (projectId) {
                tasks =
                    tasks.filter(
                        task =>
                            task.projectId ===
                            projectId
                    );
            }

            res.json({
                success: true,
                count: tasks.length,
                tasks
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to search tasks."
            });
        }
    }
);

// ==========================================
// PROJECT PROGRESS
// ==========================================

app.get(
    "/api/projects/:id/progress",
    (req, res) => {
        try {
            const projectId =
                req.params.id;

            const database =
                readDatabase();

            const project =
                database.projects.find(
                    project =>
                        project.id ===
                        projectId
                );

            if (!project) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Project not found."
                });
            }

            const tasks =
                database.tasks.filter(
                    task =>
                        task.projectId ===
                        projectId
                );

            const total =
                tasks.length;

            const completed =
                tasks.filter(
                    task =>
                        task.status ===
                        "completed"
                ).length;

            const inProgress =
                tasks.filter(
                    task =>
                        task.status ===
                        "in-progress"
                ).length;

            const todo =
                tasks.filter(
                    task =>
                        task.status ===
                        "todo"
                ).length;

            const overdue =
                tasks.filter(
                    task =>
                        isTaskOverdue(
                            task
                        )
                ).length;

            const progress =
                calculateProjectProgress(
                    tasks
                );

            res.json({
                success: true,

                projectId,

                total,

                completed,

                inProgress,

                todo,

                overdue,

                progress
            });
        } catch (error) {
            console.error(error);

            res.status(500).json({
                success: false,
                message:
                    "Unable to calculate project progress."
            });
        }
    }
);

// ==========================================
// START SERVER
// ==========================================

app.listen(
    PORT,
    () => {
        console.log(
            `Server running at http://localhost:${PORT}`
        );
    }
);