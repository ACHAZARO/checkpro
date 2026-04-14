# CheckPro

SaaS de reloj checador con GPS para PyMES mexicanas.

## Stack
- Next.js 14 App Router (src/ directory)
- Supabase (PostgreSQL + Auth)
- Vercel deployment
- Tailwind CSS dark theme

## URLs
- Landing: /
- Checador empleados: /check
- Dashboard admin: /dashboard

## Fix log
- jsconfig.json: @/* → ./src/*
- supabase.js: browser client only (no next/headers)
- supabase-server.js: server/service clients
- API routes: use supabase-server
