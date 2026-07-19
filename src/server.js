import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import morgan from 'morgan';
import { readStore, writeStore, nextTicketId } from './data/store.js';
import { requireAuth, allowRoles } from './middleware/auth.js';
import { enrichTicket, resolutionNote } from './services/ticketAi.js';

const app = express();
const port = process.env.PORT || 5000;
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());
app.use(morgan('dev'));

const publicUser = ({ passwordHash, ...user }) => user;
const sign = user => jwt.sign({ id: user.id, role: user.role, name: user.name, email: user.email }, process.env.JWT_SECRET || 'smartdesk-local-development-secret', { expiresIn: '8h' });
const event = (ticketId, type, message, user) => ({ id: crypto.randomUUID(), ticketId, type, message, user: user.name, createdAt: new Date().toISOString() });

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'smartdesk-api' }));

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });
  const data = readStore();
  const user = data.users.find(item => item.email.toLowerCase() === email.toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ message: 'Invalid email or password.' });
  res.json({ token: sign(user), user: publicUser(user) });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, department = 'General' } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'Name, email, and password are required.' });
  if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  const data = readStore();
  if (data.users.some(user => user.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ message: 'An account already uses this email.' });
  const user = { id: crypto.randomUUID(), name, email, department, role: 'user', passwordHash: await bcrypt.hash(password, 12), createdAt: new Date().toISOString() };
  data.users.push(user); writeStore(data);
  res.status(201).json({ token: sign(user), user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = readStore().users.find(item => item.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  res.json({ user: publicUser(user) });
});

app.post('/api/ai/enrich-ticket', requireAuth, (req, res) => {
  if (!req.body.description?.trim()) return res.status(400).json({ message: 'Issue description is required.' });
  res.json(enrichTicket(req.body.description));
});

app.get('/api/dashboard', requireAuth, (req, res) => {
  const { tickets } = readStore();
  const visible = req.user.role === 'admin' ? tickets : tickets.filter(ticket => ticket.requesterId === req.user.id);
  const open = visible.filter(ticket => !['Resolved', 'Closed'].includes(ticket.status));
  res.json({ openTickets: open.length, highPriority: open.filter(ticket => ['High', 'Critical'].includes(ticket.priority)).length, resolvedToday: visible.filter(ticket => ticket.status === 'Resolved').length, recentTickets: visible.slice(0, 5) });
});

app.get('/api/tickets', requireAuth, (req, res) => {
  const { status, priority, search = '' } = req.query;
  let tickets = readStore().tickets;
  if (req.user.role !== 'admin') tickets = tickets.filter(ticket => ticket.requesterId === req.user.id);
  if (status) tickets = tickets.filter(ticket => ticket.status === status);
  if (priority) tickets = tickets.filter(ticket => ticket.priority === priority);
  const term = search.toLowerCase();
  if (term) tickets = tickets.filter(ticket => `${ticket.id} ${ticket.title} ${ticket.summary} ${ticket.category}`.toLowerCase().includes(term));
  res.json({ tickets, total: tickets.length });
});

app.post('/api/tickets', requireAuth, (req, res) => {
  const { description, title, summary, category, priority, team, department } = req.body;
  if (!description?.trim()) return res.status(400).json({ message: 'Issue description is required.' });
  const data = readStore(); const ai = enrichTicket(description); const now = new Date().toISOString();
  const ticket = { id: nextTicketId(data.tickets), title: title || ai.title, summary: summary || ai.summary, description, category: category || ai.category, priority: priority || ai.priority, team: team || ai.team, status: 'Open', requester: req.user.name, requesterId: req.user.id, department: department || req.user.department, createdAt: now, updatedAt: now, comments: 0, suggestedSolution: ai.suggestedSolution, resolution: null };
  data.tickets.unshift(ticket); data.history.unshift(event(ticket.id, 'created', 'Ticket created', req.user)); writeStore(data);
  res.status(201).json({ ticket });
});

app.get('/api/tickets/:id', requireAuth, (req, res) => {
  const data = readStore(); const ticket = data.tickets.find(item => item.id === req.params.id);
  if (!ticket || (req.user.role !== 'admin' && ticket.requesterId !== req.user.id)) return res.status(404).json({ message: 'Ticket not found.' });
  res.json({ ticket, history: data.history.filter(item => item.ticketId === ticket.id), comments: data.comments.filter(item => item.ticketId === ticket.id) });
});

app.patch('/api/tickets/:id', requireAuth, allowRoles('admin'), (req, res) => {
  const data = readStore(); const ticket = data.tickets.find(item => item.id === req.params.id);
  if (!ticket) return res.status(404).json({ message: 'Ticket not found.' });
  const { status, team, priority, resolution } = req.body;
  if (status) { ticket.status = status; data.history.unshift(event(ticket.id, 'status_changed', `Status changed to ${status}`, req.user)); }
  if (team && team !== ticket.team) { ticket.team = team; data.history.unshift(event(ticket.id, 'assigned', `Assigned to ${team}`, req.user)); }
  if (priority) ticket.priority = priority;
  if (resolution || status === 'Resolved') ticket.resolution = resolutionNote(ticket, resolution);
  ticket.updatedAt = new Date().toISOString(); writeStore(data);
  res.json({ ticket });
});

app.get('/api/tickets/:id/history', requireAuth, (req, res) => {
  const data = readStore(); const ticket = data.tickets.find(item => item.id === req.params.id);
  if (!ticket || (req.user.role !== 'admin' && ticket.requesterId !== req.user.id)) return res.status(404).json({ message: 'Ticket not found.' });
  res.json({ history: data.history.filter(item => item.ticketId === ticket.id) });
});

app.get('/api/tickets/:id/comments', requireAuth, (req, res) => res.json({ comments: readStore().comments.filter(item => item.ticketId === req.params.id) }));
app.post('/api/tickets/:id/comments', requireAuth, (req, res) => {
  const { message } = req.body; if (!message?.trim()) return res.status(400).json({ message: 'Comment text is required.' });
  const data = readStore(); const ticket = data.tickets.find(item => item.id === req.params.id);
  if (!ticket || (req.user.role !== 'admin' && ticket.requesterId !== req.user.id)) return res.status(404).json({ message: 'Ticket not found.' });
  const comment = { id: crypto.randomUUID(), ticketId: ticket.id, message: message.trim(), author: req.user.name, authorId: req.user.id, createdAt: new Date().toISOString() };
  data.comments.unshift(comment); ticket.comments = data.comments.filter(item => item.ticketId === ticket.id).length; data.history.unshift(event(ticket.id, 'commented', 'Comment added', req.user)); writeStore(data);
  res.status(201).json({ comment });
});

app.use((_req, res) => res.status(404).json({ message: 'Route not found.' }));

// Vercel invokes the Express app as a serverless function. Keep a local
// listener only when this module is run directly with `npm start`.
if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`SmartDesk API listening on http://localhost:${port}`));
}

export default app;
