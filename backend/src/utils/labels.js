const TZ = 'Europe/London';

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: TZ });
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const ymd = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ });
const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: TZ });

/** "Just now", "1 min ago", "12 mins ago", "2 hrs ago". */
function timeAgo(date, now = new Date()) {
  const mins = Math.floor((now - date) / 60000);
  if (mins < 1) return 'Just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} mins ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? '1 hr ago' : `${hrs} hrs ago`;
}

const londonDay = (date) => ymd.format(date); // YYYY-MM-DD in UK time
const dateLabel = (date) => dayMonth.format(date); // "12 Oct"

/** "Today, 19:42", "Yesterday, 21:10", "12 Oct, 18:05". */
function tripTimeLabel(date, now = new Date()) {
  const day = londonDay(date);
  const today = londonDay(now);
  const yesterday = londonDay(new Date(now.getTime() - 86400000));
  const prefix = day === today ? 'Today' : day === yesterday ? 'Yesterday' : dateLabel(date);
  return `${prefix}, ${time.format(date)}`;
}

const weekdayLetter = (date) => weekday.format(date).charAt(0);

module.exports = { TZ, timeAgo, londonDay, dateLabel, tripTimeLabel, weekdayLetter };
