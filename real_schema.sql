--
-- PostgreSQL database dump
--

\restrict S5JaA91FQDlDpbWP36OsvgS8GDtIcPb4asSbiJwKslLP0ccetEwJ04moLXHrzFg

-- Dumped from database version 14.23 (Homebrew)
-- Dumped by pg_dump version 14.23 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_settings (
    id integer NOT NULL,
    setting_key text NOT NULL,
    setting_value text NOT NULL,
    description text,
    updated_at timestamp without time zone DEFAULT now(),
    updated_by integer
);


--
-- Name: admin_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admin_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_settings_id_seq OWNED BY public.admin_settings.id;


--
-- Name: customer_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    store_id integer NOT NULL,
    label character varying(50) DEFAULT 'Home'::character varying,
    recipient_name character varying(100),
    recipient_mobile character varying(20),
    address_line1 character varying(255),
    address_line2 character varying(255),
    city character varying(100),
    state character varying(100),
    pincode character varying(10),
    landmark character varying(255),
    is_default boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id character varying(20) NOT NULL,
    store_id integer NOT NULL,
    phone character varying(20) NOT NULL,
    name character varying(100),
    is_verified boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    email character varying(255)
);


--
-- Name: order_returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_returns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    return_id character varying(20) NOT NULL,
    order_id uuid NOT NULL,
    store_id integer NOT NULL,
    reason character varying(50) NOT NULL,
    status character varying(30) DEFAULT 'requested'::character varying NOT NULL,
    reject_reason text,
    return_shipping_method character varying(20),
    customer_courier_name character varying(100),
    customer_tracking_number character varying(100),
    courier_name character varying(100),
    tracking_number character varying(100),
    pickup_date date,
    operator_comment text,
    requested_at timestamp without time zone DEFAULT now(),
    approved_at timestamp without time zone,
    rejected_at timestamp without time zone,
    parcel_received_at timestamp without time zone,
    refund_initiated_at timestamp without time zone,
    refunded_at timestamp without time zone,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: order_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    status character varying(50) NOT NULL,
    changed_by character varying(100),
    notes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: order_tracking; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_tracking (
    id integer NOT NULL,
    order_id text NOT NULL,
    store_id integer NOT NULL,
    courier_name text NOT NULL,
    tracking_number text NOT NULL,
    tracking_url text,
    courier_notes text,
    last_status text DEFAULT 'pending'::text,
    last_status_message text,
    last_checked timestamp without time zone DEFAULT now(),
    status_details jsonb DEFAULT '{"events": []}'::jsonb,
    estimated_delivery date,
    auto_update boolean DEFAULT true,
    update_frequency integer DEFAULT 60,
    created_by text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: order_tracking_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.order_tracking_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: order_tracking_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.order_tracking_id_seq OWNED BY public.order_tracking.id;


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id character varying(20) NOT NULL,
    store_id integer NOT NULL,
    customer_id uuid,
    customer_name character varying(100),
    customer_email character varying(255),
    customer_phone character varying(20),
    items jsonb NOT NULL,
    delivery_address jsonb,
    subtotal numeric(10,2),
    delivery_charge numeric(10,2) DEFAULT 0,
    tax_amount numeric(10,2) DEFAULT 0,
    total_amount numeric(10,2) NOT NULL,
    payment_method character varying(30),
    status character varying(50) DEFAULT 'pending'::character varying,
    payment_status character varying(50) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    shipped_at timestamp without time zone,
    delivered_at timestamp without time zone,
    customer_upi_id character varying(100),
    store_payment_gateway_account_id integer,
    gateway_transaction_id character varying(255)
);


--
-- Name: otp_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone character varying(20) NOT NULL,
    email character varying(255),
    code character varying(6) NOT NULL,
    purpose character varying(20) DEFAULT 'login'::character varying,
    expires_at timestamp without time zone NOT NULL,
    is_used boolean DEFAULT false,
    attempts integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    ip_address character varying(45)
);


--
-- Name: payment_gateways; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_gateways (
    id integer NOT NULL,
    gateway_key character varying(50) NOT NULL,
    display_name character varying(100) NOT NULL,
    requires_kyc boolean DEFAULT false,
    is_active boolean DEFAULT true,
    phase character varying(20),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: payment_gateways_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payment_gateways_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payment_gateways_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payment_gateways_id_seq OWNED BY public.payment_gateways.id;


--
-- Name: pricing_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_key character varying(50) NOT NULL,
    display_name character varying(100) NOT NULL,
    base_amount numeric(10,2) NOT NULL,
    tax_percentage numeric(5,2) DEFAULT 18 NOT NULL,
    validity_days integer DEFAULT 365 NOT NULL,
    is_active boolean DEFAULT true,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    billing_cycle character varying(20) DEFAULT 'annual'::character varying NOT NULL
);


--
-- Name: store_admin_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_admin_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id integer NOT NULL,
    password_encrypted text NOT NULL,
    active_session_token text,
    session_last_active timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: store_couriers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_couriers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id integer NOT NULL,
    courier_name character varying(100) NOT NULL,
    tracking_url_template text,
    auto_track_key character varying(50),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: store_domain_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_domain_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id integer NOT NULL,
    domain_type character varying(20) NOT NULL,
    custom_domain character varying(255),
    hosting_type character varying(20) NOT NULL,
    own_hosting_server_ip character varying(45),
    own_hosting_provider character varying(100),
    dns_status character varying(20) DEFAULT 'not_required'::character varying NOT NULL,
    dns_verified_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: store_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id integer NOT NULL,
    store_id integer NOT NULL,
    image_type character varying(50) NOT NULL,
    reference_id text,
    original_filename character varying(255),
    storage_path character varying(500) NOT NULL,
    file_size bigint,
    width integer,
    height integer,
    mime_type character varying(100),
    is_active boolean DEFAULT true,
    uploaded_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: store_payment_gateway_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_payment_gateway_accounts (
    id integer NOT NULL,
    store_id integer NOT NULL,
    gateway_id integer NOT NULL,
    account_identifier character varying(255),
    kyc_status character varying(50) DEFAULT 'not_required'::character varying,
    gateway_details jsonb,
    is_enabled boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: store_payment_gateway_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.store_payment_gateway_accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: store_payment_gateway_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.store_payment_gateway_accounts_id_seq OWNED BY public.store_payment_gateway_accounts.id;


--
-- Name: store_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_permissions (
    id integer NOT NULL,
    store_id integer,
    panel_type character varying(50) NOT NULL,
    is_enabled boolean DEFAULT false,
    settings jsonb DEFAULT '{}'::jsonb,
    updated_by integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: store_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.store_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: store_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.store_permissions_id_seq OWNED BY public.store_permissions.id;


--
-- Name: store_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_id integer NOT NULL,
    plan_key character varying(50) NOT NULL,
    plan_name character varying(100),
    base_amount numeric(10,2),
    tax_amount numeric(10,2),
    total_amount numeric(10,2),
    payment_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    payment_method character varying(20),
    paid_at timestamp without time zone,
    valid_until timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    billing_cycle character varying(20) DEFAULT 'annual'::character varying
);


--
-- Name: stores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stores (
    id integer NOT NULL,
    store_id text NOT NULL,
    tenant_id integer,
    store_name text NOT NULL,
    subdomain text,
    config jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'draft'::text,
    last_builder_step integer DEFAULT 1,
    store_logo_url text,
    store_banner_url text,
    custom_domain text,
    hosting_details jsonb DEFAULT '{}'::jsonb,
    last_deployed_at timestamp without time zone,
    is_published boolean DEFAULT false,
    deleted_at timestamp without time zone,
    auto_deleted boolean DEFAULT false,
    expiry_warning_sent boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    published_at timestamp without time zone,
    default_payment_gateway_id integer
);


--
-- Name: stores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.stores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: stores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.stores_id_seq OWNED BY public.stores.id;


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id integer NOT NULL,
    tenant_id text NOT NULL,
    mobile text,
    phone text,
    email text,
    full_name text,
    business_type text,
    business_name text,
    company_name text,
    gst_number text,
    address text,
    city text,
    state text,
    pincode text,
    country text DEFAULT 'India'::text,
    password_hash text,
    password text,
    password_reset_token text,
    password_reset_expires timestamp without time zone,
    status text DEFAULT 'active'::text,
    is_active boolean DEFAULT true,
    is_verified boolean DEFAULT false,
    email_verified boolean DEFAULT false,
    store_count integer DEFAULT 0,
    login_attempts integer DEFAULT 0,
    last_login timestamp without time zone,
    subscription_tier character varying(20) DEFAULT 'trial'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    deleted_at timestamp without time zone
);


--
-- Name: tenants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenants_id_seq OWNED BY public.tenants.id;


--
-- Name: terms_acceptances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.terms_acceptances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id integer NOT NULL,
    store_id integer NOT NULL,
    terms_version character varying(50) NOT NULL,
    accepted_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    ip_address character varying(45)
);


--
-- Name: tracking_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tracking_history (
    id integer NOT NULL,
    tracking_id integer,
    status text NOT NULL,
    status_message text,
    location text,
    "timestamp" timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: tracking_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tracking_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tracking_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tracking_history_id_seq OWNED BY public.tracking_history.id;


--
-- Name: admin_settings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_settings ALTER COLUMN id SET DEFAULT nextval('public.admin_settings_id_seq'::regclass);


--
-- Name: order_tracking id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_tracking ALTER COLUMN id SET DEFAULT nextval('public.order_tracking_id_seq'::regclass);


--
-- Name: payment_gateways id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_gateways ALTER COLUMN id SET DEFAULT nextval('public.payment_gateways_id_seq'::regclass);


--
-- Name: store_payment_gateway_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_payment_gateway_accounts ALTER COLUMN id SET DEFAULT nextval('public.store_payment_gateway_accounts_id_seq'::regclass);


--
-- Name: store_permissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_permissions ALTER COLUMN id SET DEFAULT nextval('public.store_permissions_id_seq'::regclass);


--
-- Name: stores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stores ALTER COLUMN id SET DEFAULT nextval('public.stores_id_seq'::regclass);


--
-- Name: tenants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants ALTER COLUMN id SET DEFAULT nextval('public.tenants_id_seq'::regclass);


--
-- Name: tracking_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_history ALTER COLUMN id SET DEFAULT nextval('public.tracking_history_id_seq'::regclass);


--
-- Name: admin_settings admin_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_settings
    ADD CONSTRAINT admin_settings_pkey PRIMARY KEY (id);


--
-- Name: admin_settings admin_settings_setting_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_settings
    ADD CONSTRAINT admin_settings_setting_key_key UNIQUE (setting_key);


--
-- Name: customer_addresses customer_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_addresses
    ADD CONSTRAINT customer_addresses_pkey PRIMARY KEY (id);


--
-- Name: customers customers_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_customer_id_key UNIQUE (customer_id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: customers customers_store_id_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_store_id_phone_key UNIQUE (store_id, phone);


--
-- Name: order_returns order_returns_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_returns
    ADD CONSTRAINT order_returns_order_id_key UNIQUE (order_id);


--
-- Name: order_returns order_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_returns
    ADD CONSTRAINT order_returns_pkey PRIMARY KEY (id);


--
-- Name: order_returns order_returns_return_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_returns
    ADD CONSTRAINT order_returns_return_id_key UNIQUE (return_id);


--
-- Name: order_status_history order_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_pkey PRIMARY KEY (id);


--
-- Name: order_tracking order_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_tracking
    ADD CONSTRAINT order_tracking_pkey PRIMARY KEY (id);


--
-- Name: orders orders_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_id_key UNIQUE (order_id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: otp_audit otp_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_audit
    ADD CONSTRAINT otp_audit_pkey PRIMARY KEY (id);


--
-- Name: payment_gateways payment_gateways_gateway_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_gateways
    ADD CONSTRAINT payment_gateways_gateway_key_key UNIQUE (gateway_key);


--
-- Name: payment_gateways payment_gateways_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_gateways
    ADD CONSTRAINT payment_gateways_pkey PRIMARY KEY (id);


--
-- Name: pricing_plans pricing_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_plans
    ADD CONSTRAINT pricing_plans_pkey PRIMARY KEY (id);


--
-- Name: pricing_plans pricing_plans_plan_key_billing_cycle_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_plans
    ADD CONSTRAINT pricing_plans_plan_key_billing_cycle_key UNIQUE (plan_key, billing_cycle);


--
-- Name: store_admin_credentials store_admin_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_admin_credentials
    ADD CONSTRAINT store_admin_credentials_pkey PRIMARY KEY (id);


--
-- Name: store_admin_credentials store_admin_credentials_store_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_admin_credentials
    ADD CONSTRAINT store_admin_credentials_store_id_key UNIQUE (store_id);


--
-- Name: store_couriers store_couriers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_couriers
    ADD CONSTRAINT store_couriers_pkey PRIMARY KEY (id);


--
-- Name: store_couriers store_couriers_store_id_courier_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_couriers
    ADD CONSTRAINT store_couriers_store_id_courier_name_key UNIQUE (store_id, courier_name);


--
-- Name: store_domain_config store_domain_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_domain_config
    ADD CONSTRAINT store_domain_config_pkey PRIMARY KEY (id);


--
-- Name: store_domain_config store_domain_config_store_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_domain_config
    ADD CONSTRAINT store_domain_config_store_id_key UNIQUE (store_id);


--
-- Name: store_images store_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_images
    ADD CONSTRAINT store_images_pkey PRIMARY KEY (id);


--
-- Name: store_payment_gateway_accounts store_payment_gateway_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_payment_gateway_accounts
    ADD CONSTRAINT store_payment_gateway_accounts_pkey PRIMARY KEY (id);


--
-- Name: store_payment_gateway_accounts store_payment_gateway_accounts_store_id_gateway_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_payment_gateway_accounts
    ADD CONSTRAINT store_payment_gateway_accounts_store_id_gateway_id_key UNIQUE (store_id, gateway_id);


--
-- Name: store_permissions store_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_permissions
    ADD CONSTRAINT store_permissions_pkey PRIMARY KEY (id);


--
-- Name: store_permissions store_permissions_store_id_panel_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_permissions
    ADD CONSTRAINT store_permissions_store_id_panel_type_key UNIQUE (store_id, panel_type);


--
-- Name: store_subscriptions store_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_subscriptions
    ADD CONSTRAINT store_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: store_subscriptions store_subscriptions_store_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_subscriptions
    ADD CONSTRAINT store_subscriptions_store_id_key UNIQUE (store_id);


--
-- Name: stores stores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_pkey PRIMARY KEY (id);


--
-- Name: stores stores_store_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_store_id_key UNIQUE (store_id);


--
-- Name: stores stores_subdomain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_subdomain_key UNIQUE (subdomain);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_tenant_id_key UNIQUE (tenant_id);


--
-- Name: terms_acceptances terms_acceptances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.terms_acceptances
    ADD CONSTRAINT terms_acceptances_pkey PRIMARY KEY (id);


--
-- Name: tracking_history tracking_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_history
    ADD CONSTRAINT tracking_history_pkey PRIMARY KEY (id);


--
-- Name: idx_customer_addresses_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_addresses_customer ON public.customer_addresses USING btree (customer_id);


--
-- Name: idx_customers_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_store ON public.customers USING btree (store_id);


--
-- Name: idx_order_returns_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_returns_status ON public.order_returns USING btree (status);


--
-- Name: idx_order_returns_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_returns_store ON public.order_returns USING btree (store_id);


--
-- Name: idx_order_status_history_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_status_history_order ON public.order_status_history USING btree (order_id);


--
-- Name: idx_order_tracking_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_tracking_order_id ON public.order_tracking USING btree (order_id);


--
-- Name: idx_order_tracking_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_tracking_store_id ON public.order_tracking USING btree (store_id);


--
-- Name: idx_order_tracking_tracking_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_tracking_tracking_number ON public.order_tracking USING btree (tracking_number);


--
-- Name: idx_orders_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_customer ON public.orders USING btree (customer_id);


--
-- Name: idx_orders_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_store ON public.orders USING btree (store_id);


--
-- Name: idx_otp_audit_phone_purpose; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_audit_phone_purpose ON public.otp_audit USING btree (phone, purpose);


--
-- Name: idx_store_admin_credentials_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_store_admin_credentials_store ON public.store_admin_credentials USING btree (store_id);


--
-- Name: idx_store_couriers_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_store_couriers_store ON public.store_couriers USING btree (store_id);


--
-- Name: idx_store_domain_config_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_store_domain_config_store ON public.store_domain_config USING btree (store_id);


--
-- Name: idx_store_images_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_store_images_active ON public.store_images USING btree (is_active);


--
-- Name: idx_store_images_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_store_images_reference ON public.store_images USING btree (reference_id);


--
-- Name: idx_store_images_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_store_images_store ON public.store_images USING btree (store_id);


--
-- Name: idx_store_images_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_store_images_tenant ON public.store_images USING btree (tenant_id);


--
-- Name: idx_store_images_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_store_images_type ON public.store_images USING btree (image_type);


--
-- Name: idx_store_payment_gateway_accounts_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_store_payment_gateway_accounts_store ON public.store_payment_gateway_accounts USING btree (store_id);


--
-- Name: idx_store_permissions_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_store_permissions_store_id ON public.store_permissions USING btree (store_id);


--
-- Name: idx_store_subscriptions_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_store_subscriptions_store ON public.store_subscriptions USING btree (store_id);


--
-- Name: idx_stores_draft_cleanup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stores_draft_cleanup ON public.stores USING btree (status, created_at) WHERE ((status = 'draft'::text) AND (deleted_at IS NULL));


--
-- Name: idx_stores_store_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stores_store_id ON public.stores USING btree (store_id);


--
-- Name: idx_stores_subdomain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stores_subdomain ON public.stores USING btree (subdomain);


--
-- Name: idx_stores_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stores_tenant_id ON public.stores USING btree (tenant_id);


--
-- Name: idx_tenants_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_email ON public.tenants USING btree (email);


--
-- Name: idx_tenants_mobile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_mobile ON public.tenants USING btree (mobile);


--
-- Name: idx_tenants_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_phone ON public.tenants USING btree (phone);


--
-- Name: idx_tenants_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_tenant_id ON public.tenants USING btree (tenant_id);


--
-- Name: idx_terms_acceptances_store; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_terms_acceptances_store ON public.terms_acceptances USING btree (store_id);


--
-- Name: idx_terms_acceptances_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_terms_acceptances_tenant ON public.terms_acceptances USING btree (tenant_id);


--
-- Name: idx_tracking_history_tracking_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracking_history_tracking_id ON public.tracking_history USING btree (tracking_id);


--
-- Name: admin_settings admin_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_settings
    ADD CONSTRAINT admin_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.tenants(id);


--
-- Name: customer_addresses customer_addresses_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_addresses
    ADD CONSTRAINT customer_addresses_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: order_returns order_returns_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_returns
    ADD CONSTRAINT order_returns_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_status_history order_status_history_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_tracking order_tracking_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_tracking
    ADD CONSTRAINT order_tracking_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(order_id) ON DELETE CASCADE;


--
-- Name: order_tracking order_tracking_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_tracking
    ADD CONSTRAINT order_tracking_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: orders orders_store_payment_gateway_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_store_payment_gateway_account_id_fkey FOREIGN KEY (store_payment_gateway_account_id) REFERENCES public.store_payment_gateway_accounts(id);


--
-- Name: store_couriers store_couriers_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_couriers
    ADD CONSTRAINT store_couriers_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: store_payment_gateway_accounts store_payment_gateway_accounts_gateway_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_payment_gateway_accounts
    ADD CONSTRAINT store_payment_gateway_accounts_gateway_id_fkey FOREIGN KEY (gateway_id) REFERENCES public.payment_gateways(id);


--
-- Name: store_payment_gateway_accounts store_payment_gateway_accounts_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_payment_gateway_accounts
    ADD CONSTRAINT store_payment_gateway_accounts_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: store_permissions store_permissions_store_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_permissions
    ADD CONSTRAINT store_permissions_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: store_permissions store_permissions_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_permissions
    ADD CONSTRAINT store_permissions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.tenants(id);


--
-- Name: stores stores_default_payment_gateway_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_default_payment_gateway_id_fkey FOREIGN KEY (default_payment_gateway_id) REFERENCES public.payment_gateways(id);


--
-- Name: stores stores_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tracking_history tracking_history_tracking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_history
    ADD CONSTRAINT tracking_history_tracking_id_fkey FOREIGN KEY (tracking_id) REFERENCES public.order_tracking(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict S5JaA91FQDlDpbWP36OsvgS8GDtIcPb4asSbiJwKslLP0ccetEwJ04moLXHrzFg

