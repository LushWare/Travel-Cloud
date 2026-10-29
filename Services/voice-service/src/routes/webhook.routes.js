import express from 'express';
import { requireElevenLabsSignature } from '../middleware/elevenLabsSignature.js';
import { requireInitiationSecret } from '../middleware/initiationSecret.js';
import { handleInboundCall, handlePostCall } from '../controllers/webhook.controller.js';

const router = express.Router();

router.post('/inbound', requireInitiationSecret, handleInboundCall);
router.post('/post-call', requireElevenLabsSignature, handlePostCall);

export default router;
