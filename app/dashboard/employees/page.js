'use client'
// src/app/dashboard/employees/page.js
import { useState, useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase';
import { Plus, Trash2, Edit2, Lock, Unlock } from 'lucide-react';
import { date } from 'date-fns';
const subabase = createClient();

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [filter