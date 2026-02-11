import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER || 'hello@govconedu.com',
    pass: process.env.SMTP_PASSWORD,
  },
});

interface WeeklyDigestData {
  email: string;
  overallProgress: number;
  completedTasks: number;
  totalTasks: number;
  tasksThisWeek: string[];
  currentStreak: number;
  badges: { icon: string; name: string }[];
  nextTasks: string[];
}

const QUOTES = [
  { text: "Consistency wins contracts.", author: "Eric Coffie" },
  { text: "Your network is your net worth in government contracting.", author: "Eric Coffie" },
  { text: "Every 'no' gets you closer to a 'yes'.", author: "Eric Coffie" },
  { text: "Preparation meets opportunity in government contracting.", author: "Eric Coffie" },
  { text: "The best time to start was yesterday. The second best time is now.", author: "Eric Coffie" },
  { text: "Small businesses built this country. Government contracts can build yours.", author: "Eric Coffie" },
];

export async function sendWeeklyDigestEmail(data: WeeklyDigestData): Promise<boolean> {
  const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  const plannerUrl = 'https://tools.govcongiants.org/planner';

  const streakText = data.currentStreak > 0
    ? `<span style="font-size: 32px; font-weight: bold; color: #1e40af;">${data.currentStreak}</span><br><span style="color: #6b7280; font-size: 14px;">day streak</span>`
    : '<span style="color: #6b7280; font-size: 14px;">Start a streak by completing a task today!</span>';

  const tasksThisWeekHtml = data.tasksThisWeek.length > 0
    ? data.tasksThisWeek.map(t => `<li style="margin-bottom: 6px; color: #15803d;">${t}</li>`).join('')
    : '<li style="color: #6b7280;">No tasks completed this week — jump back in!</li>';

  const nextTasksHtml = data.nextTasks
    .map(t => `<li style="margin-bottom: 6px; color: #1e40af;">${t}</li>`)
    .join('');

  const badgesHtml = data.badges.length > 0
    ? data.badges.map(b => `<span style="display: inline-block; background: #1e40af; color: white; padding: 4px 12px; border-radius: 20px; margin: 3px; font-size: 13px;">${b.icon} ${b.name}</span>`).join('')
    : '<span style="color: #9ca3af; font-size: 14px;">Complete tasks to earn your first badge!</span>';

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8fafc;">
  <div style="background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">Your Weekly GovCon Action Plan Update</h1>
    <p style="color: #93c5fd; margin: 10px 0 0 0;">GovCon Giants Planner</p>
  </div>

  <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">

    <!-- Progress -->
    <div style="text-align: center; margin-bottom: 30px;">
      <div style="font-size: 48px; font-weight: bold; color: ${data.overallProgress === 100 ? '#10b981' : '#1e40af'};">${data.overallProgress}%</div>
      <div style="color: #6b7280; font-size: 16px;">${data.completedTasks} of ${data.totalTasks} tasks completed</div>
    </div>

    <!-- Stats Row -->
    <div style="display: flex; text-align: center; margin-bottom: 30px;">
      <div style="flex: 1; padding: 15px; background: #f0f9ff; border-radius: 8px; margin-right: 8px;">
        <div style="font-size: 14px; color: #6b7280; margin-bottom: 4px;">This Week</div>
        <div style="font-size: 24px; font-weight: bold; color: #1e40af;">${data.tasksThisWeek.length}</div>
        <div style="font-size: 12px; color: #9ca3af;">tasks done</div>
      </div>
      <div style="flex: 1; padding: 15px; background: #f0f9ff; border-radius: 8px;">
        ${streakText}
      </div>
    </div>

    <!-- Tasks This Week -->
    <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
      <h3 style="color: #166534; margin: 0 0 10px 0;">This Week&apos;s Wins</h3>
      <ul style="margin: 0; padding-left: 20px;">
        ${tasksThisWeekHtml}
      </ul>
    </div>

    <!-- Badges -->
    <div style="margin-bottom: 20px;">
      <h3 style="color: #1e3a8a; margin: 0 0 10px 0;">Your Badges</h3>
      <div>${badgesHtml}</div>
    </div>

    <!-- Next Up -->
    ${data.nextTasks.length > 0 ? `
    <div style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
      <h3 style="color: #1e3a8a; margin: 0 0 10px 0;">Up Next</h3>
      <ul style="margin: 0; padding-left: 20px;">
        ${nextTasksHtml}
      </ul>
    </div>
    ` : ''}

    <!-- Quote -->
    <div style="background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); border-radius: 8px; padding: 20px; margin-bottom: 25px; text-align: center;">
      <p style="color: white; font-style: italic; font-size: 16px; margin: 0 0 5px 0;">"${quote.text}"</p>
      <p style="color: #93c5fd; font-size: 13px; margin: 0;">— ${quote.author}</p>
    </div>

    <!-- CTA -->
    <div style="text-align: center; margin: 30px 0 20px 0;">
      <a href="${plannerUrl}" style="background: #1e40af; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 18px;">Continue Your Plan</a>
    </div>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">

    <p style="color: #9ca3af; font-size: 12px; text-align: center;">
      You're receiving this because you're enrolled in the GovCon Giants Action Planner.<br>
      &copy; ${new Date().getFullYear()} GovCon Giants. All rights reserved.
    </p>
  </div>
</body>
</html>
`;

  const plainText = `Your Weekly GovCon Action Plan Update

Progress: ${data.overallProgress}% complete (${data.completedTasks} of ${data.totalTasks} tasks)

This Week: ${data.tasksThisWeek.length > 0 ? data.tasksThisWeek.join(', ') : 'No tasks completed this week'}

Streak: ${data.currentStreak > 0 ? `${data.currentStreak}-day streak` : 'Start a streak by completing a task today!'}

Badges Earned: ${data.badges.length > 0 ? data.badges.map(b => `${b.icon} ${b.name}`).join(', ') : 'None yet'}

${data.nextTasks.length > 0 ? `Up Next:\n${data.nextTasks.map(t => `- ${t}`).join('\n')}` : ''}

"${quote.text}" — ${quote.author}

Continue your plan: ${plannerUrl}

- GovCon Giants Team`;

  try {
    await transporter.sendMail({
      from: `"GovCon Giants Planner" <${process.env.SMTP_USER || 'hello@govconedu.com'}>`,
      to: data.email,
      subject: `You're ${data.overallProgress}% done — Weekly Action Plan Update`,
      html: htmlContent,
      text: plainText,
    });
    return true;
  } catch (error) {
    console.error(`Failed to send weekly digest to ${data.email}:`, error);
    return false;
  }
}
