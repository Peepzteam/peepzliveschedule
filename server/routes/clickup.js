const express = require('express');
const axios = require('axios');
const qs = require('qs');
const router = express.Router();

const CLICKUP_BASE = 'https://api.clickup.com/api/v2';
const SPACE_IDS = ['90188976211', '901810864855', '90188976482', '901810934101'];
const RAWE_SPACE_ID = '901810934101';

// cache team/user IDs to avoid repeated calls
let _teamId = null;
let _userId = null;

function getClient() {
  return axios.create({
    baseURL: CLICKUP_BASE,
    headers: { Authorization: process.env.CLICKUP_API_TOKEN },
    paramsSerializer: (p) => qs.stringify(p, { arrayFormat: 'brackets' }),
  });
}

async function getTeamAndUser(client) {
  if (_teamId && _userId) return { teamId: _teamId, userId: _userId };
  const [teamRes, userRes] = await Promise.all([
    client.get('/team'),
    client.get('/user'),
  ]);
  _teamId = teamRes.data.teams?.[0]?.id;
  _userId = userRes.data.user?.id;
  return { teamId: _teamId, userId: _userId };
}

function todayRange() {
  const s = new Date(); s.setHours(0, 0, 0, 0);
  const e = new Date(); e.setHours(23, 59, 59, 999);
  return { start: s.getTime(), end: e.getTime() };
}

function fmt(task) {
  return {
    id: task.id,
    name: task.name,
    status: task.status?.status || '',
    statusColor: task.status?.color || '#666',
    priority: task.priority?.priority || null,
    priorityColor: task.priority?.color || null,
    dueDate: task.due_date ? Number(task.due_date) : null,
    assignees: (task.assignees || []).map((a) => a.username || a.email || ''),
    url: task.url || '',
    listName: task.list?.name || '',
    spaceName: task.space?.name || '',
  };
}

// GET /api/clickup/tasks
router.get('/tasks', async (req, res) => {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) {
    return res.json({
      error: 'ยังไม่ได้ตั้งค่า CLICKUP_API_TOKEN',
      today: [], overdue: [], rawe: [], prae: [],
    });
  }

  const client = getClient();

  try {
    const { teamId, userId } = await getTeamAndUser(client);
    if (!teamId) throw new Error('ไม่พบ Team ID ใน ClickUp');

    const { start, end } = todayRange();

    const safe = async (params) => {
      try {
        const { data } = await client.get(`/team/${teamId}/task`, { params });
        return data.tasks || [];
      } catch (e) {
        console.error('ClickUp fetch warn:', e.response?.data?.err || e.message);
        return [];
      }
    };

    const [today, overdue, rawe, prae] = await Promise.all([
      safe({
        'space_ids[]': SPACE_IDS,
        due_date_gt: start - 1,
        due_date_lt: end + 1,
        include_closed: false,
        subtasks: true,
      }),
      safe({
        'space_ids[]': SPACE_IDS,
        overdue: true,
        include_closed: false,
        order_by: 'due_date',
        reverse: false,
      }),
      safe({
        'space_ids[]': [RAWE_SPACE_ID],
        include_closed: false,
        order_by: 'updated',
        reverse: true,
        page: 0,
      }),
      safe({
        'space_ids[]': SPACE_IDS,
        'assignees[]': [userId],
        include_closed: false,
        order_by: 'due_date',
        subtasks: true,
      }),
    ]);

    res.json({
      today: today.map(fmt),
      overdue: overdue.map(fmt),
      rawe: rawe.slice(0, 25).map(fmt),
      prae: prae.slice(0, 30).map(fmt),
    });
  } catch (err) {
    console.error('ClickUp error:', err.response?.data || err.message);
    res.status(500).json({
      error: 'ดึงข้อมูล ClickUp ไม่ได้ค่า: ' + (err.response?.data?.err || err.message),
      today: [], overdue: [], rawe: [], prae: [],
    });
  }
});

module.exports = router;
