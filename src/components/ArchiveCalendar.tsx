import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { monthName } from '../archive';
import type { ArchiveMonth, ArchiveYear } from '../types';

type ArchiveCalendarProps = {
  basePath: string;
  label: string;
  years: ArchiveYear[];
  selectedYear?: string;
  selectedMonth?: string;
  selectedDay?: string;
  search?: string;
};

type CalendarDay = {
  date?: number;
  day?: string;
  count?: number;
  href?: string;
};

const monthNumbers = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ArchiveCalendar({
  basePath,
  label,
  years,
  selectedYear,
  selectedMonth,
  selectedDay,
  search = '',
}: ArchiveCalendarProps) {
  const navigate = useNavigate();
  const selection = resolveSelection(years, selectedYear, selectedMonth);

  if (!selection) {
    return null;
  }

  const { year, month } = selection;
  const previous = adjacentMonth(years, year.year, month.month, -1);
  const next = adjacentMonth(years, year.year, month.month, 1);
  const days = calendarDays(basePath, year.year, month, search);
  const availableMonths = new Set(year.months.map((item) => item.month));

  return (
    <aside className="archive-calendar" aria-label={`${label} calendar`}>
      <div className="archive-calendar__heading">
        <p className="eyebrow">{label}</p>
        <h2>{monthName(year.year, month.month)}</h2>
      </div>

      <div className="archive-calendar__controls">
        <button
          type="button"
          title="Previous month"
          disabled={!previous}
          onClick={() => previous && navigate(`${basePath}/${previous.year}/${previous.month}${search}`)}
        >
          <ChevronLeft aria-hidden="true" size={18} />
        </button>

        <select
          aria-label="Archive year"
          value={year.year}
          onChange={(event) => navigate(`${basePath}/${event.target.value}${search}`)}
        >
          {years.map((item) => (
            <option value={item.year} key={item.year}>
              {item.year}
            </option>
          ))}
        </select>

        <select
          aria-label="Archive month"
          value={month.month}
          onChange={(event) => navigate(`${basePath}/${year.year}/${event.target.value}${search}`)}
        >
          {monthNumbers.map((item) => (
            <option value={item} disabled={!availableMonths.has(item)} key={item}>
              {monthName(year.year, item).replace(` ${year.year}`, '')}
            </option>
          ))}
        </select>

        <button
          type="button"
          title="Next month"
          disabled={!next}
          onClick={() => next && navigate(`${basePath}/${next.year}/${next.month}${search}`)}
        >
          <ChevronRight aria-hidden="true" size={18} />
        </button>
      </div>

      <div className="archive-calendar__weekdays" aria-hidden="true">
        {weekdays.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>

      <div className="archive-calendar__grid">
        {days.map((item, index) =>
          item.href ? (
            <Link
              className={
                item.day === selectedDay
                  ? 'archive-calendar__day archive-calendar__day--active'
                  : 'archive-calendar__day'
              }
              to={item.href}
              key={item.day}
            >
              <span>{item.date}</span>
              <small>{item.count}</small>
            </Link>
          ) : (
            <span className="archive-calendar__day archive-calendar__day--empty" key={`empty-${index}`}>
              {item.date ? <span>{item.date}</span> : null}
            </span>
          ),
        )}
      </div>
    </aside>
  );
}

export function resolveSelection(years: ArchiveYear[], selectedYear?: string, selectedMonth?: string) {
  const year = years.find((item) => item.year === selectedYear) ?? years[0];

  if (!year) {
    return undefined;
  }

  const month = year.months.find((item) => item.month === selectedMonth) ?? year.months[0];

  if (!month) {
    return undefined;
  }

  return { year, month };
}

function calendarDays(basePath: string, year: string, month: ArchiveMonth, search: string): CalendarDay[] {
  const firstDay = new Date(`${year}-${month.month}-01T00:00:00`).getDay();
  const totalDays = new Date(Number(year), Number(month.month), 0).getDate();
  const daysByNumber = new Map(month.days.map((day) => [day.day, day]));
  const days: CalendarDay[] = [];

  for (let index = 0; index < firstDay; index += 1) {
    days.push({});
  }

  for (let date = 1; date <= totalDays; date += 1) {
    const day = String(date).padStart(2, '0');
    const archiveDay = daysByNumber.get(day);

    days.push({
      date,
      day,
      count: archiveDay?.count,
      href: archiveDay ? `${basePath}/${year}/${month.month}/${day}${search}` : undefined,
    });
  }

  return days;
}

function adjacentMonth(years: ArchiveYear[], year: string, month: string, direction: -1 | 1) {
  const months = years
    .flatMap((item) => item.months.map((child) => ({ year: item.year, month: child.month })))
    .sort((a, b) => `${a.year}-${a.month}`.localeCompare(`${b.year}-${b.month}`));
  const index = months.findIndex((item) => item.year === year && item.month === month);

  if (index === -1) {
    return undefined;
  }

  return months[index + direction];
}
