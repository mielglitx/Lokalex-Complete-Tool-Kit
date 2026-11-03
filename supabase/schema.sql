-- ============================================================================
-- LOKALEX SUPABASE DATABASE SCHEMA
-- Migration from Firebase Realtime Database (33 Nodes)
-- ============================================================================

-- Enable UUID extension (useful for new ID generation)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. OPERATIONAL & ROSTER TABLES
-- ============================================================================

-- Riders (Staff accounts, credentials, settings)
CREATE TABLE IF NOT EXISTS public.riders (
    id TEXT PRIMARY KEY,
    name TEXT,
    pin TEXT,
    phone TEXT,
    status TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to riders" ON public.riders FOR ALL USING (true) WITH CHECK (true);

-- Live Roster (Active shift queue, catering status, breaks, cooldowns)
CREATE TABLE IF NOT EXISTS public.roster (
    id TEXT PRIMARY KEY, -- riderId
    name TEXT,
    status TEXT,
    customer_name TEXT,
    queue_time BIGINT,
    break_start BIGINT,
    break_duration INT DEFAULT 0,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.roster ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to roster" ON public.roster FOR ALL USING (true) WITH CHECK (true);

-- Shift Logins (Daily clock-in/out records, location pins, total break time)
CREATE TABLE IF NOT EXISTS public.logins (
    id TEXT PRIMARY KEY, -- riderId
    rider_id TEXT,
    rider_name TEXT,
    date TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.logins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to logins" ON public.logins FOR ALL USING (true) WITH CHECK (true);

-- Rider Day-offs
CREATE TABLE IF NOT EXISTS public.rider_dayoffs (
    id TEXT PRIMARY KEY, -- riderId
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.rider_dayoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to rider_dayoffs" ON public.rider_dayoffs FOR ALL USING (true) WITH CHECK (true);

-- Swap Requests (Duty swap requests between riders)
CREATE TABLE IF NOT EXISTS public.swap_requests (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.swap_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to swap_requests" ON public.swap_requests FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 2. CUSTOMER & CHAT SYSTEM TABLES
-- ============================================================================

-- Customers
CREATE TABLE IF NOT EXISTS public.customers (
    id TEXT PRIMARY KEY,
    name TEXT,
    phone TEXT,
    address TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to customers" ON public.customers FOR ALL USING (true) WITH CHECK (true);

-- Customer Chat Metadata (Inbox, active catering, folders, unread flags)
CREATE TABLE IF NOT EXISTS public.customer_chat_meta (
    id TEXT PRIMARY KEY, -- customerId (e.g. fb_... or cust_...)
    customer_name TEXT,
    folder TEXT,
    status TEXT,
    catered_by_rider_id TEXT,
    catered_by_rider_name TEXT,
    last_updated BIGINT,
    unread_for_rider BOOLEAN DEFAULT FALSE,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_chat_meta_folder ON public.customer_chat_meta(folder);
CREATE INDEX IF NOT EXISTS idx_customer_chat_meta_catered_by ON public.customer_chat_meta(catered_by_rider_id);
CREATE INDEX IF NOT EXISTS idx_customer_chat_meta_last_updated ON public.customer_chat_meta(last_updated DESC);
ALTER TABLE public.customer_chat_meta ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to customer_chat_meta" ON public.customer_chat_meta FOR ALL USING (true) WITH CHECK (true);

-- Chat Messages (Full message history partitioned by customer)
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id TEXT PRIMARY KEY, -- messageId or mid
    customer_id TEXT NOT NULL,
    sender TEXT,
    sender_type TEXT,
    is_rider BOOLEAN DEFAULT FALSE,
    text TEXT,
    image_url TEXT,
    timestamp BIGINT NOT NULL,
    status TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_cust_time ON public.chat_messages(customer_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON public.chat_messages(timestamp DESC);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to chat_messages" ON public.chat_messages FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 3. FINANCIAL, TRANSACTIONS & RECEIPTS
-- ============================================================================

-- Receipts (Completed deliveries, fees, distances, timestamps)
CREATE TABLE IF NOT EXISTS public.receipts (
    id TEXT PRIMARY KEY,
    tx_id TEXT,
    rider_id TEXT,
    rider_name TEXT,
    customer_name TEXT,
    date TEXT,
    total_fees NUMERIC,
    timestamp BIGINT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_receipts_rider_date ON public.receipts(rider_id, date);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON public.receipts(date);
CREATE INDEX IF NOT EXISTS idx_receipts_timestamp ON public.receipts(timestamp DESC);
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to receipts" ON public.receipts FOR ALL USING (true) WITH CHECK (true);

-- Catered History
CREATE TABLE IF NOT EXISTS public.catered_history (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.catered_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to catered_history" ON public.catered_history FOR ALL USING (true) WITH CHECK (true);

-- Catered Daily Aggregates
CREATE TABLE IF NOT EXISTS public.catered (
    id TEXT PRIMARY KEY, -- date
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.catered ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to catered" ON public.catered FOR ALL USING (true) WITH CHECK (true);

-- GCash Balances & Logs
CREATE TABLE IF NOT EXISTS public.gcash (
    id TEXT PRIMARY KEY, -- riderId
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.gcash ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to gcash" ON public.gcash FOR ALL USING (true) WITH CHECK (true);

-- Daily Totals
CREATE TABLE IF NOT EXISTS public.daily_totals (
    id TEXT PRIMARY KEY, -- date
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.daily_totals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to daily_totals" ON public.daily_totals FOR ALL USING (true) WITH CHECK (true);

-- Commission Penalties
CREATE TABLE IF NOT EXISTS public.commission_penalties (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.commission_penalties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to commission_penalties" ON public.commission_penalties FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 4. DIRECTORY & MAPS
-- ============================================================================

-- Customer Directory Profiles
CREATE TABLE IF NOT EXISTS public.directory (
    id TEXT PRIMARY KEY,
    name TEXT,
    phone TEXT,
    address TEXT,
    category TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_directory_name ON public.directory(name);
CREATE INDEX IF NOT EXISTS idx_directory_phone ON public.directory(phone);
ALTER TABLE public.directory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to directory" ON public.directory FOR ALL USING (true) WITH CHECK (true);

-- Store Menu Galleries (Extracted from directory node for performance)
CREATE TABLE IF NOT EXISTS public.store_menu_galleries (
    store_id TEXT PRIMARY KEY,
    pages JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.store_menu_galleries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to store_menu_galleries" ON public.store_menu_galleries FOR ALL USING (true) WITH CHECK (true);

-- Map Calculations
CREATE TABLE IF NOT EXISTS public.map_calculations (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.map_calculations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to map_calculations" ON public.map_calculations FOR ALL USING (true) WITH CHECK (true);

-- Live Tracking & Sessions
CREATE TABLE IF NOT EXISTS public.live_sessions (
    id TEXT PRIMARY KEY,
    rider_id TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to live_sessions" ON public.live_sessions FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.live_tracking (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.live_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to live_tracking" ON public.live_tracking FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 5. MERCHANT, STORE & ORDER TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stores (
    id TEXT PRIMARY KEY,
    name TEXT,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to stores" ON public.stores FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.store_accounts (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.store_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to store_accounts" ON public.store_accounts FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.store_menus (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.store_menus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to store_menus" ON public.store_menus FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.store_orders (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.store_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to store_orders" ON public.store_orders FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.store_rider_chats (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.store_rider_chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to store_rider_chats" ON public.store_rider_chats FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.store_rider_chat_meta (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.store_rider_chat_meta ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to store_rider_chat_meta" ON public.store_rider_chat_meta FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.orders (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to orders" ON public.orders FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.advanced_orders (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.advanced_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to advanced_orders" ON public.advanced_orders FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 6. SYSTEM, CHANNELS, REPLIES & GENERIC KV STORE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.team_chat (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.team_chat ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to team_chat" ON public.team_chat FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.shared_quick_replies (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.shared_quick_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to shared_quick_replies" ON public.shared_quick_replies FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.facebook_channels (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.facebook_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to facebook_channels" ON public.facebook_channels FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.phones (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.phones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to phones" ON public.phones FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.emails (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to emails" ON public.emails FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.settings (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to settings" ON public.settings FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.admin_settings (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to admin_settings" ON public.admin_settings FOR ALL USING (true) WITH CHECK (true);

-- Generic Key-Value fallback table for arbitrary root nodes or dynamic paths
CREATE TABLE IF NOT EXISTS public.app_state_kv (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.app_state_kv ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to app_state_kv" ON public.app_state_kv FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- 7. ENABLE REALTIME ON REACTIVE TABLES
-- ============================================================================
DO $$
BEGIN
  -- Add each table to supabase_realtime publication if not already present
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.roster; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.riders; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.logins; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_chat_meta; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.live_sessions; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.live_tracking; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.settings; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_settings; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.advanced_orders; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.swap_requests; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.team_chat; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.app_state_kv; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

