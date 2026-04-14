'use client'
// src/app/dashboard/attendance/page.js
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { parse, format, startOfMonth, endOfMonth } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
const supabase = createClient();

export default function AttendancePage() {
  const [shifts, setShifts] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [employees, setEmployees] = useState([]);

