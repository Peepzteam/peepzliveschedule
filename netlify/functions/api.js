/**
 * Netlify Function — wraps Express app ด้วย serverless-http
 * รับ request ทั้งหมดที่ path ขึ้นด้วย /api/* และ /auth/*
 */
const serverless = require('serverless-http');
const app = require('../../server/app');

module.exports.handler = serverless(app);
