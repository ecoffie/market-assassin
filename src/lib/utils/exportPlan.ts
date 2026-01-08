// Note: This file should only be imported in client components
// jsPDF will be imported dynamically to avoid SSR issues

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type jsPDFExtended = any;

// Task interface matching the phase page
export interface TaskForExport {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  dueDate?: string;
  notes: string;
}

export interface PhaseDataForExport {
  phaseId: number;
  phaseName: string;
  phaseIcon: string;
  tasks: TaskForExport[];
  userName?: string;
  progress: number;
  completedTasks: number;
  totalTasks: number;
}

/**
 * Export a phase to PDF
 */
export async function exportPhaseToPDF(phaseData: PhaseDataForExport): Promise<void> {
  if (typeof window === 'undefined') {
    console.error('PDF export is only available in the browser');
    return;
  }

  // Dynamic import to avoid SSR issues
  const jsPDFModule = await import('jspdf');
  const jsPDF = jsPDFModule.default;
  const doc: jsPDFExtended = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - (margin * 2);
  let yPosition = margin;

  // Helper function to add a new page if needed
  const checkPageBreak = (requiredHeight: number) => {
    if (yPosition + requiredHeight > pageHeight - margin) {
      doc.addPage();
      yPosition = margin;
      return true;
    }
    return false;
  };

  // Helper function to add text with word wrapping
  const addWrappedText = (text: string, x: number, y: number, maxWidth: number, fontSize: number = 10) => {
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, maxWidth);
    doc.text(lines, x, y);
    return lines.length * (fontSize * 0.4); // Return height used
  };

  // Header Section
  doc.setFillColor(30, 64, 175); // #1e40af
  doc.rect(0, 0, pageWidth, 40, 'F');
  
  // Logo/Title
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('GovCon Giants', margin, 25);
  
  // User name (if provided)
  if (phaseData.userName) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Action Plan for: ${phaseData.userName}`, margin, 35);
  }

  yPosition = 50;

  // Phase Title Section
  doc.setTextColor(30, 64, 175);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  const phaseTitle = `${phaseData.phaseIcon} Phase ${phaseData.phaseId}: ${phaseData.phaseName}`;
  doc.text(phaseTitle, margin, yPosition);
  yPosition += 10;

  // Progress Summary
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  const progressText = `Progress: ${phaseData.progress}% (${phaseData.completedTasks} of ${phaseData.totalTasks} tasks completed)`;
  doc.text(progressText, margin, yPosition);
  yPosition += 15;

  // Tasks Section
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Tasks', margin, yPosition);
  yPosition += 10;

  // Draw line under "Tasks" heading
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, yPosition - 5, pageWidth - margin, yPosition - 5);
  yPosition += 5;

  // Task List
  phaseData.tasks.forEach((task, index) => {
    // Check if we need a new page
    checkPageBreak(30);

    // Task checkbox and title
    const checkboxSize = 4;
    const checkboxX = margin;
    const checkboxY = yPosition - 3;
    
    // Draw checkbox
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);
    doc.rect(checkboxX, checkboxY, checkboxSize, checkboxSize, 'S');
    
    // Checkmark if completed
    if (task.completed) {
      doc.setFontSize(8);
      doc.text('✓', checkboxX + 1.5, checkboxY + 3);
    }

    // Task title
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    const titleX = margin + checkboxSize + 5;
    const titleMaxWidth = contentWidth - checkboxSize - 5;
    const titleHeight = addWrappedText(
      task.completed ? `✓ ${task.title}` : task.title,
      titleX,
      yPosition,
      titleMaxWidth,
      11
    );
    yPosition += titleHeight + 2;

    // Task description
    if (task.description) {
      checkPageBreak(15);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      const descHeight = addWrappedText(task.description, titleX, yPosition, titleMaxWidth, 9);
      yPosition += descHeight + 3;
    }

    // Due date (if exists)
    if (task.dueDate) {
      checkPageBreak(8);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      const dueDate = new Date(task.dueDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      doc.text(`Due: ${dueDate}`, titleX, yPosition);
      yPosition += 5;
    }

    // Notes (if exists)
    if (task.notes && task.notes.trim()) {
      checkPageBreak(15);
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.setFont('helvetica', 'italic');
      const notesText = `Notes: ${task.notes}`;
      const notesHeight = addWrappedText(notesText, titleX, yPosition, titleMaxWidth, 8);
      yPosition += notesHeight + 3;
    }

    // Reset text color
    doc.setTextColor(0, 0, 0);
    
    // Add spacing between tasks
    yPosition += 5;

    // Add page break if we're getting close to the bottom
    if (yPosition > pageHeight - 30) {
      doc.addPage();
      yPosition = margin;
    }
  });

  // Footer on each page
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.setFont('helvetica', 'normal');
    const footerText = 'Powered by GovCon Giants';
    const footerWidth = doc.getTextWidth(footerText);
    doc.text(footerText, pageWidth - margin - footerWidth, pageHeight - 10);
    doc.text(`Page ${i} of ${totalPages}`, margin, pageHeight - 10);
  }

  // Generate filename
  const phaseNameSlug = phaseData.phaseName.toLowerCase().replace(/\s+/g, '-');
  const filename = `govcon-action-plan-phase-${phaseData.phaseId}-${phaseNameSlug}.pdf`;

  // Save the PDF
  doc.save(filename);
}

/**
 * Export full plan (all phases) to PDF
 */
export async function exportFullPlanToPDF(phases: PhaseDataForExport[], userName?: string): Promise<void> {
  if (typeof window === 'undefined') {
    console.error('PDF export is only available in the browser');
    return;
  }

  // Dynamic import to avoid SSR issues
  const jsPDFModule = await import('jspdf');
  const jsPDF = jsPDFModule.default;
  const doc: jsPDFExtended = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - (margin * 2);
  let yPosition = margin;

  // Helper functions (same as above)
  const checkPageBreak = (requiredHeight: number) => {
    if (yPosition + requiredHeight > pageHeight - margin) {
      doc.addPage();
      yPosition = margin;
      return true;
    }
    return false;
  };

  const addWrappedText = (text: string, x: number, y: number, maxWidth: number, fontSize: number = 10) => {
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, maxWidth);
    doc.text(lines, x, y);
    return lines.length * (fontSize * 0.4);
  };

  // Header
  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageWidth, 40, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('GovCon Giants', margin, 25);
  
  if (userName) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`2026 Action Plan for: ${userName}`, margin, 35);
  } else {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('2026 GovCon Action Plan', margin, 35);
  }

  yPosition = 50;

  // Table of Contents
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Table of Contents', margin, yPosition);
  yPosition += 10;

  doc.setDrawColor(200, 200, 200);
  doc.line(margin, yPosition - 5, pageWidth - margin, yPosition - 5);
  yPosition += 5;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  phases.forEach((phase) => {
    checkPageBreak(10);
    const tocText = `${phase.phaseIcon} Phase ${phase.phaseId}: ${phase.phaseName} (${phase.progress}% complete)`;
    doc.text(tocText, margin + 5, yPosition);
    yPosition += 8;
  });

  yPosition += 10;

  // Export each phase
  phases.forEach((phase) => {
    // Phase header
    checkPageBreak(40);
    doc.addPage();
    yPosition = margin;

    // Phase Title
    doc.setTextColor(30, 64, 175);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    const phaseTitle = `${phase.phaseIcon} Phase ${phase.phaseId}: ${phase.phaseName}`;
    doc.text(phaseTitle, margin, yPosition);
    yPosition += 10;

    // Progress
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    const progressText = `Progress: ${phase.progress}% (${phase.completedTasks} of ${phase.totalTasks} tasks completed)`;
    doc.text(progressText, margin, yPosition);
    yPosition += 15;

    // Tasks
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Tasks', margin, yPosition);
    yPosition += 10;

    doc.setDrawColor(200, 200, 200);
    doc.line(margin, yPosition - 5, pageWidth - margin, yPosition - 5);
    yPosition += 5;

    // Task list (same as single phase export)
    phase.tasks.forEach((task) => {
      checkPageBreak(30);

      const checkboxSize = 4;
      const checkboxX = margin;
      const checkboxY = yPosition - 3;
      
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5);
      doc.rect(checkboxX, checkboxY, checkboxSize, checkboxSize, 'S');
      
      if (task.completed) {
        doc.setFontSize(8);
        doc.text('✓', checkboxX + 1.5, checkboxY + 3);
      }

      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      const titleX = margin + checkboxSize + 5;
      const titleMaxWidth = contentWidth - checkboxSize - 5;
      const titleHeight = addWrappedText(
        task.completed ? `✓ ${task.title}` : task.title,
        titleX,
        yPosition,
        titleMaxWidth,
        11
      );
      yPosition += titleHeight + 2;

      if (task.description) {
        checkPageBreak(15);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80, 80, 80);
        const descHeight = addWrappedText(task.description, titleX, yPosition, titleMaxWidth, 9);
        yPosition += descHeight + 3;
      }

      if (task.dueDate) {
        checkPageBreak(8);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        const dueDate = new Date(task.dueDate).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        doc.text(`Due: ${dueDate}`, titleX, yPosition);
        yPosition += 5;
      }

      if (task.notes && task.notes.trim()) {
        checkPageBreak(15);
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.setFont('helvetica', 'italic');
        const notesText = `Notes: ${task.notes}`;
        const notesHeight = addWrappedText(notesText, titleX, yPosition, titleMaxWidth, 8);
        yPosition += notesHeight + 3;
      }

      doc.setTextColor(0, 0, 0);
      yPosition += 5;

      if (yPosition > pageHeight - 30) {
        doc.addPage();
        yPosition = margin;
      }
    });
  });

  // Footer on each page
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.setFont('helvetica', 'normal');
    const footerText = 'Powered by GovCon Giants';
    const footerWidth = doc.getTextWidth(footerText);
    doc.text(footerText, pageWidth - margin - footerWidth, pageHeight - 10);
    doc.text(`Page ${i} of ${totalPages}`, margin, pageHeight - 10);
  }

  // Generate filename
  const filename = `govcon-action-plan-full-${new Date().getFullYear()}.pdf`;

  // Save the PDF
  doc.save(filename);
}

