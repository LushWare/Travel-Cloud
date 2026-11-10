import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { extractUser } from './middleware/auth.js';
import errorHandler from './middleware/errorHandler.js';
import { correlationId, requestLogger } from './middleware/requestLogger.js';
import logger from './config/logger.js';
import billingRoutes from './routes/billing.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import quotationRoutes from './routes/quotation.routes.js';
import paymentReceiptRoutes from './routes/paymentReceipt.routes.js';
import paymentHistoryRoutes from './routes/paymentHistory.routes.js';
import creditNoteRoutes from './routes/creditNote.routes.js';
import voucherRoutes from './routes/voucher.routes.js';
import { installTenantFetch, tenantMiddleware } from '../../shared/tenancy/src/index.js';

const app = express();
const PORT = process.env.PORT || 3006;
const V1 = '/api/v1';

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
// Request ID + structured logging (replaces morgan)
app.use(correlationId);
app.use(requestLogger);
// Every request runs inside the agency the gateway took from the login.
app.use(tenantMiddleware);
// Calls to our other services carry the same agency.
installTenantFetch();
app.use(express.json());
app.use(cookieParser());
app.use(extractUser);

// Mirror the monolith URL structure exactly
app.use(`${V1}/billing/invoices`, invoiceRoutes);
app.use(`${V1}/billing/quotations`, quotationRoutes);
app.use(`${V1}/billing/receipts`, paymentReceiptRoutes);
app.use(`${V1}/billing/credit-notes`, creditNoteRoutes);
app.use(`${V1}/billing/vouchers`, voucherRoutes);
app.use(`${V1}/billing/payment-history`, paymentHistoryRoutes);
app.use(`${V1}/billing`, billingRoutes);

// Legacy top-level invoice route (monolith had both /invoices and /billing/invoices)
app.use(`${V1}/invoices`, invoiceRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'billing-service' }));
app.use(errorHandler);

app.listen(PORT, () => logger.info({ port: PORT }, 'billing-service started'));
