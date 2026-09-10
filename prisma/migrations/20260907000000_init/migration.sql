-- CreateTable
CREATE TABLE "schools" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "academicModel" TEXT NOT NULL DEFAULT 'HIGHER_ED',
    "status" TEXT NOT NULL DEFAULT 'PROVISIONING',
    "plan" TEXT,
    "country" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en-NG',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "currencyCode" TEXT NOT NULL DEFAULT 'NGN',
    "brandColor" TEXT NOT NULL DEFAULT '#1b5df5',
    "logoUrl" TEXT,
    "primaryDomain" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "school_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "gradingJson" TEXT NOT NULL,
    "enrollmentJson" TEXT NOT NULL,
    "admissionsJson" TEXT NOT NULL,
    "financeJson" TEXT NOT NULL,
    "brandingJson" TEXT NOT NULL,
    "localeJson" TEXT NOT NULL,
    "registrationPortalJson" TEXT NOT NULL,
    "k12Json" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "school_configs_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "title" TEXT,
    "orgUnitId" TEXT,
    "managerId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "memberships_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "memberships_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_units" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "memberships_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_admins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "org_units" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "parentId" TEXT,
    "headMembershipId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "org_units_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "org_units_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "org_units" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "identity_providers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "issuer" TEXT,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "metadataUrl" TEXT,
    "emailDomains" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "identity_providers_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" TEXT,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "faculties" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "departments_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "faculties" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "programs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "degreeType" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "creditsRequired" INTEGER NOT NULL DEFAULT 120,
    "durationTerms" INTEGER NOT NULL DEFAULT 8,
    "minCgpaToGraduate" REAL NOT NULL DEFAULT 1.5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "programs_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "program_requirements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CORE',
    "level" INTEGER NOT NULL DEFAULT 100,
    CONSTRAINT "program_requirements_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "program_requirements_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "terms" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "registrationOpensAt" DATETIME NOT NULL,
    "registrationClosesAt" DATETIME NOT NULL,
    "addDropDeadline" DATETIME NOT NULL,
    "withdrawalDeadline" DATETIME NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "creditHours" INTEGER NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 100,
    "departmentId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "courses_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "prerequisites" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "prerequisiteId" TEXT NOT NULL,
    "minGradePoint" REAL NOT NULL DEFAULT 1.0,
    "isConcurrent" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "prerequisites_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "prerequisites_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "courses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "course_offerings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "section" TEXT NOT NULL DEFAULT 'A',
    "instructorId" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 50,
    "seatsTaken" INTEGER NOT NULL DEFAULT 0,
    "waitlistCapacity" INTEGER NOT NULL DEFAULT 10,
    "room" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "gradesPosted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "course_offerings_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "course_offerings_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "course_offerings_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "instructors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "room" TEXT,
    CONSTRAINT "meetings_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "course_offerings" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "students" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matricNumber" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 100,
    "admissionTermCode" TEXT,
    "dateOfBirth" DATETIME,
    "gender" TEXT,
    "nationality" TEXT,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "academicStanding" TEXT NOT NULL DEFAULT 'GOOD',
    "cgpa" REAL NOT NULL DEFAULT 0,
    "creditsEarned" INTEGER NOT NULL DEFAULT 0,
    "creditsAttempted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "students_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "students_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "instructors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "staffNumber" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "rank" TEXT NOT NULL DEFAULT 'LECTURER',
    "officeRoom" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "instructors_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "instructors_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "applicants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateOfBirth" DATETIME,
    "gender" TEXT,
    "nationality" TEXT,
    "address" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "applicants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "priorGpaScore" REAL,
    "entranceExamScore" REAL,
    "essayScore" REAL,
    "interviewScore" REAL,
    "extracurricularScore" REAL,
    "compositeScore" REAL,
    "rankInCohort" INTEGER,
    "personalStatement" TEXT,
    "previousSchool" TEXT,
    "submittedAt" DATETIME,
    "decidedAt" DATETIME,
    "decisionNote" TEXT,
    "offerExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "applications_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "applicants" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "applications_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "applications_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "application_reviews" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "academicScore" REAL NOT NULL,
    "essayScore" REAL NOT NULL,
    "interviewScore" REAL,
    "extracurricularScore" REAL,
    "recommendation" TEXT NOT NULL,
    "comments" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "application_reviews_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "application_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "application_documents_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REGISTERED',
    "waitlistPosition" INTEGER,
    "caScore" REAL,
    "examScore" REAL,
    "totalScore" REAL,
    "letterGrade" TEXT,
    "gradePoint" REAL,
    "isRepeatSuperseded" BOOLEAN NOT NULL DEFAULT false,
    "enrolledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "droppedAt" DATETIME,
    "gradedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "enrollments_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "course_offerings" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "term_gpas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "creditsAttempted" INTEGER NOT NULL,
    "creditsEarned" INTEGER NOT NULL,
    "qualityPoints" REAL NOT NULL,
    "gpa" REAL NOT NULL,
    "cumulativeGpa" REAL NOT NULL,
    "academicStanding" TEXT NOT NULL,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "term_gpas_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "term_gpas_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "holds" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "blocksRegistration" BOOLEAN NOT NULL DEFAULT true,
    "blocksTranscript" BOOLEAN NOT NULL DEFAULT false,
    "placedBy" TEXT,
    "placedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" DATETIME,
    "releasedBy" TEXT,
    CONSTRAINT "holds_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fee_structures" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "programId" TEXT,
    "level" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fee_structures_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fee_structures_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "fee_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "feeStructureId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "perCreditHour" BOOLEAN NOT NULL DEFAULT false,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "fee_items_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "fee_structures" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATETIME NOT NULL,
    "voidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "invoices_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "invoices_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmountMinor" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "externalRef" TEXT,
    "note" TEXT,
    "unappliedMinor" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "payment_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT '',
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "authorId" TEXT,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME
);

-- CreateTable
CREATE TABLE "year_groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "form_classes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "yearGroupId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "formTeacherId" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 30,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "form_classes_yearGroupId_fkey" FOREIGN KEY ("yearGroupId") REFERENCES "year_groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "form_classes_formTeacherId_fkey" FOREIGN KEY ("formTeacherId") REFERENCES "instructors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "yearGroupId" TEXT,
    "isCore" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subjects_yearGroupId_fkey" FOREIGN KEY ("yearGroupId") REFERENCES "year_groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "subject_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "formClassId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "teacherId" TEXT,
    "marksPosted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subject_assignments_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subject_assignments_formClassId_fkey" FOREIGN KEY ("formClassId") REFERENCES "form_classes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subject_assignments_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subject_assignments_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "instructors" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "class_enrolments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "formClassId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "class_enrolments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "class_enrolments_formClassId_fkey" FOREIGN KEY ("formClassId") REFERENCES "form_classes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "class_enrolments_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "subject_results" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "caScore" REAL,
    "examScore" REAL,
    "totalScore" REAL,
    "letterGrade" TEXT,
    "gradePoint" REAL,
    "positionInClass" INTEGER,
    "classAverage" REAL,
    "remark" TEXT,
    "gradedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "subject_results_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subject_results_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "subject_assignments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "recordedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_records_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attendance_records_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "report_cards" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "formClassCode" TEXT NOT NULL,
    "totalMarks" REAL NOT NULL,
    "maxMarks" REAL NOT NULL,
    "average" REAL NOT NULL,
    "classAverage" REAL NOT NULL,
    "positionInClass" INTEGER NOT NULL,
    "classSize" INTEGER NOT NULL,
    "overallGrade" TEXT NOT NULL,
    "daysPresent" INTEGER NOT NULL DEFAULT 0,
    "daysAbsent" INTEGER NOT NULL DEFAULT 0,
    "daysLate" INTEGER NOT NULL DEFAULT 0,
    "daysInTerm" INTEGER NOT NULL DEFAULT 0,
    "promotionDecision" TEXT NOT NULL DEFAULT 'PENDING',
    "promotionReason" TEXT,
    "classTeacherRemark" TEXT,
    "headTeacherRemark" TEXT,
    "traitsJson" TEXT,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "report_cards_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "report_cards_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "report_card_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "reportCardId" TEXT NOT NULL,
    "subjectCode" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "caScore" REAL,
    "examScore" REAL,
    "totalScore" REAL,
    "letterGrade" TEXT,
    "classAverage" REAL,
    "positionInClass" INTEGER,
    "remark" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "report_card_lines_reportCardId_fkey" FOREIGN KEY ("reportCardId") REFERENCES "report_cards" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "occupation" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "guardians_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "guardian_students" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "relationship" TEXT NOT NULL DEFAULT 'GUARDIAN',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "canViewFinance" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "guardian_students_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "guardians" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "guardian_students_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'GENERAL',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "assigneeId" TEXT,
    "assignerId" TEXT,
    "orgUnitId" TEXT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "dueAt" DATETIME,
    "startedAt" DATETIME,
    "submittedAt" DATETIME,
    "completedAt" DATETIME,
    "escalatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "tasks_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_assignerId_fkey" FOREIGN KEY ("assignerId") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "org_units" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_comments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "memberships" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "summary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_watchers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_watchers_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_watchers_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "notifications_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "forums" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "audience" TEXT NOT NULL DEFAULT 'STUDENT',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "forums_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "forum_categories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "forumId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "forum_categories_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "forums" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "threads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "forumId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT,
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "reactionCount" INTEGER NOT NULL DEFAULT 0,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastPostAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "threads_forumId_fkey" FOREIGN KEY ("forumId") REFERENCES "forums" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "threads_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "forum_categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "threads_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "isOpeningPost" BOOLEAN NOT NULL DEFAULT false,
    "reactionCount" INTEGER NOT NULL DEFAULT 0,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "editedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "posts_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "post_reactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'LIKE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "post_reactions_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "post_reactions_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "post_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "postId" TEXT,
    "threadId" TEXT,
    "reporterId" TEXT,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "taskId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" DATETIME,
    "resolution" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "post_reports_postId_fkey" FOREIGN KEY ("postId") REFERENCES "posts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "post_reports_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "post_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "post_reports_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "library_resources" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'DOCUMENT',
    "url" TEXT NOT NULL,
    "publisher" TEXT,
    "isbn" TEXT,
    "edition" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "pageCount" INTEGER,
    "durationMin" INTEGER,
    "tags" TEXT NOT NULL DEFAULT '',
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "programIdsJson" TEXT NOT NULL DEFAULT '[]',
    "yearGroupIdsJson" TEXT NOT NULL DEFAULT '[]',
    "levelsJson" TEXT NOT NULL DEFAULT '[]',
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "addedById" TEXT,
    "publishedAt" DATETIME,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "library_resources_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "library_resources_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "resource_collections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "curatorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resource_collections_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "resource_collections_curatorId_fkey" FOREIGN KEY ("curatorId") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "resource_collection_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "note" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "resource_collection_items_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "resource_collections" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "resource_collection_items_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "library_resources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "resource_views" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "membershipId" TEXT,
    "viewedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resource_views_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "library_resources" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "resource_views_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT,
    "action" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMinor" INTEGER NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL DEFAULT 'NGN',
    "billingPeriod" TEXT NOT NULL DEFAULT 'ANNUAL',
    "maxStudents" INTEGER,
    "maxStaff" INTEGER,
    "featuresJson" TEXT NOT NULL DEFAULT '{}',
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TRIALING',
    "seatOverrideStudents" INTEGER,
    "seatOverrideStaff" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trialEndsAt" DATETIME,
    "renewsAt" DATETIME,
    "cancelledAt" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "subscriptions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "subscription_invoices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schoolId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currencyCode" TEXT NOT NULL DEFAULT 'NGN',
    "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "issuedAt" DATETIME,
    "dueAt" DATETIME,
    "paidAt" DATETIME,
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "subscription_invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "subscription_invoice_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitMinor" INTEGER NOT NULL DEFAULT 0,
    "amountMinor" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "subscription_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "subscription_invoices" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "schools_slug_key" ON "schools"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "schools_code_key" ON "schools"("code");

-- CreateIndex
CREATE INDEX "schools_status_idx" ON "schools"("status");

-- CreateIndex
CREATE UNIQUE INDEX "school_configs_schoolId_key" ON "school_configs"("schoolId");

-- CreateIndex
CREATE INDEX "memberships_schoolId_role_idx" ON "memberships"("schoolId", "role");

-- CreateIndex
CREATE INDEX "memberships_managerId_idx" ON "memberships"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_schoolId_key" ON "memberships"("userId", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_userId_key" ON "platform_admins"("userId");

-- CreateIndex
CREATE INDEX "org_units_schoolId_parentId_idx" ON "org_units"("schoolId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "org_units_schoolId_code_key" ON "org_units"("schoolId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "identity_providers_schoolId_kind_key" ON "identity_providers"("schoolId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "audit_logs_schoolId_createdAt_idx" ON "audit_logs"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "faculties_schoolId_idx" ON "faculties"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "faculties_schoolId_code_key" ON "faculties"("schoolId", "code");

-- CreateIndex
CREATE INDEX "departments_schoolId_idx" ON "departments"("schoolId");

-- CreateIndex
CREATE INDEX "departments_facultyId_idx" ON "departments"("facultyId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_schoolId_code_key" ON "departments"("schoolId", "code");

-- CreateIndex
CREATE INDEX "programs_schoolId_idx" ON "programs"("schoolId");

-- CreateIndex
CREATE INDEX "programs_departmentId_idx" ON "programs"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "programs_schoolId_code_key" ON "programs"("schoolId", "code");

-- CreateIndex
CREATE INDEX "program_requirements_schoolId_idx" ON "program_requirements"("schoolId");

-- CreateIndex
CREATE INDEX "program_requirements_courseId_idx" ON "program_requirements"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "program_requirements_programId_courseId_key" ON "program_requirements"("programId", "courseId");

-- CreateIndex
CREATE INDEX "terms_schoolId_isCurrent_idx" ON "terms"("schoolId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "terms_schoolId_code_key" ON "terms"("schoolId", "code");

-- CreateIndex
CREATE INDEX "courses_schoolId_idx" ON "courses"("schoolId");

-- CreateIndex
CREATE INDEX "courses_departmentId_idx" ON "courses"("departmentId");

-- CreateIndex
CREATE INDEX "courses_level_idx" ON "courses"("level");

-- CreateIndex
CREATE UNIQUE INDEX "courses_schoolId_code_key" ON "courses"("schoolId", "code");

-- CreateIndex
CREATE INDEX "prerequisites_schoolId_idx" ON "prerequisites"("schoolId");

-- CreateIndex
CREATE INDEX "prerequisites_prerequisiteId_idx" ON "prerequisites"("prerequisiteId");

-- CreateIndex
CREATE UNIQUE INDEX "prerequisites_courseId_prerequisiteId_key" ON "prerequisites"("courseId", "prerequisiteId");

-- CreateIndex
CREATE INDEX "course_offerings_schoolId_idx" ON "course_offerings"("schoolId");

-- CreateIndex
CREATE INDEX "course_offerings_termId_idx" ON "course_offerings"("termId");

-- CreateIndex
CREATE INDEX "course_offerings_instructorId_idx" ON "course_offerings"("instructorId");

-- CreateIndex
CREATE UNIQUE INDEX "course_offerings_courseId_termId_section_key" ON "course_offerings"("courseId", "termId", "section");

-- CreateIndex
CREATE INDEX "meetings_schoolId_idx" ON "meetings"("schoolId");

-- CreateIndex
CREATE INDEX "meetings_offeringId_idx" ON "meetings"("offeringId");

-- CreateIndex
CREATE INDEX "meetings_dayOfWeek_idx" ON "meetings"("dayOfWeek");

-- CreateIndex
CREATE INDEX "students_schoolId_status_idx" ON "students"("schoolId", "status");

-- CreateIndex
CREATE INDEX "students_programId_idx" ON "students"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "students_schoolId_userId_key" ON "students"("schoolId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "students_schoolId_matricNumber_key" ON "students"("schoolId", "matricNumber");

-- CreateIndex
CREATE INDEX "instructors_schoolId_idx" ON "instructors"("schoolId");

-- CreateIndex
CREATE INDEX "instructors_departmentId_idx" ON "instructors"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "instructors_schoolId_userId_key" ON "instructors"("schoolId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "instructors_schoolId_staffNumber_key" ON "instructors"("schoolId", "staffNumber");

-- CreateIndex
CREATE INDEX "applicants_schoolId_idx" ON "applicants"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "applicants_schoolId_userId_key" ON "applicants"("schoolId", "userId");

-- CreateIndex
CREATE INDEX "applications_schoolId_status_idx" ON "applications"("schoolId", "status");

-- CreateIndex
CREATE INDEX "applications_programId_termId_status_idx" ON "applications"("programId", "termId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "applications_schoolId_referenceNo_key" ON "applications"("schoolId", "referenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "applications_applicantId_programId_termId_key" ON "applications"("applicantId", "programId", "termId");

-- CreateIndex
CREATE INDEX "application_reviews_schoolId_idx" ON "application_reviews"("schoolId");

-- CreateIndex
CREATE INDEX "application_reviews_applicationId_idx" ON "application_reviews"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "application_reviews_applicationId_reviewerId_key" ON "application_reviews"("applicationId", "reviewerId");

-- CreateIndex
CREATE INDEX "application_documents_schoolId_idx" ON "application_documents"("schoolId");

-- CreateIndex
CREATE INDEX "application_documents_applicationId_idx" ON "application_documents"("applicationId");

-- CreateIndex
CREATE INDEX "enrollments_schoolId_idx" ON "enrollments"("schoolId");

-- CreateIndex
CREATE INDEX "enrollments_offeringId_status_idx" ON "enrollments"("offeringId", "status");

-- CreateIndex
CREATE INDEX "enrollments_studentId_status_idx" ON "enrollments"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_studentId_offeringId_key" ON "enrollments"("studentId", "offeringId");

-- CreateIndex
CREATE INDEX "term_gpas_schoolId_idx" ON "term_gpas"("schoolId");

-- CreateIndex
CREATE INDEX "term_gpas_studentId_idx" ON "term_gpas"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "term_gpas_studentId_termId_key" ON "term_gpas"("studentId", "termId");

-- CreateIndex
CREATE INDEX "holds_schoolId_idx" ON "holds"("schoolId");

-- CreateIndex
CREATE INDEX "holds_studentId_releasedAt_idx" ON "holds"("studentId", "releasedAt");

-- CreateIndex
CREATE INDEX "fee_structures_schoolId_idx" ON "fee_structures"("schoolId");

-- CreateIndex
CREATE INDEX "fee_structures_termId_programId_level_idx" ON "fee_structures"("termId", "programId", "level");

-- CreateIndex
CREATE INDEX "fee_items_schoolId_idx" ON "fee_items"("schoolId");

-- CreateIndex
CREATE INDEX "fee_items_feeStructureId_idx" ON "fee_items"("feeStructureId");

-- CreateIndex
CREATE INDEX "invoices_schoolId_status_dueDate_idx" ON "invoices"("schoolId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_schoolId_invoiceNo_key" ON "invoices"("schoolId", "invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_studentId_termId_key" ON "invoices"("studentId", "termId");

-- CreateIndex
CREATE INDEX "invoice_lines_schoolId_idx" ON "invoice_lines"("schoolId");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_idx" ON "invoice_lines"("invoiceId");

-- CreateIndex
CREATE INDEX "payments_schoolId_studentId_receivedAt_idx" ON "payments"("schoolId", "studentId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_schoolId_receiptNo_key" ON "payments"("schoolId", "receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "payments_schoolId_externalRef_key" ON "payments"("schoolId", "externalRef");

-- CreateIndex
CREATE INDEX "payment_allocations_schoolId_idx" ON "payment_allocations"("schoolId");

-- CreateIndex
CREATE INDEX "payment_allocations_invoiceId_idx" ON "payment_allocations"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_paymentId_invoiceId_key" ON "payment_allocations"("paymentId", "invoiceId");

-- CreateIndex
CREATE INDEX "announcements_schoolId_publishedAt_idx" ON "announcements"("schoolId", "publishedAt");

-- CreateIndex
CREATE INDEX "year_groups_schoolId_sequence_idx" ON "year_groups"("schoolId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "year_groups_schoolId_code_key" ON "year_groups"("schoolId", "code");

-- CreateIndex
CREATE INDEX "form_classes_schoolId_yearGroupId_idx" ON "form_classes"("schoolId", "yearGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "form_classes_schoolId_code_key" ON "form_classes"("schoolId", "code");

-- CreateIndex
CREATE INDEX "subjects_schoolId_yearGroupId_idx" ON "subjects"("schoolId", "yearGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_schoolId_code_key" ON "subjects"("schoolId", "code");

-- CreateIndex
CREATE INDEX "subject_assignments_schoolId_termId_idx" ON "subject_assignments"("schoolId", "termId");

-- CreateIndex
CREATE INDEX "subject_assignments_teacherId_idx" ON "subject_assignments"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "subject_assignments_subjectId_formClassId_termId_key" ON "subject_assignments"("subjectId", "formClassId", "termId");

-- CreateIndex
CREATE INDEX "class_enrolments_schoolId_formClassId_termId_idx" ON "class_enrolments"("schoolId", "formClassId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "class_enrolments_studentId_termId_key" ON "class_enrolments"("studentId", "termId");

-- CreateIndex
CREATE INDEX "subject_results_schoolId_assignmentId_idx" ON "subject_results"("schoolId", "assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "subject_results_studentId_assignmentId_key" ON "subject_results"("studentId", "assignmentId");

-- CreateIndex
CREATE INDEX "attendance_records_schoolId_termId_date_idx" ON "attendance_records"("schoolId", "termId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_studentId_date_key" ON "attendance_records"("studentId", "date");

-- CreateIndex
CREATE INDEX "report_cards_schoolId_termId_idx" ON "report_cards"("schoolId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "report_cards_studentId_termId_key" ON "report_cards"("studentId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "report_cards_schoolId_referenceNo_key" ON "report_cards"("schoolId", "referenceNo");

-- CreateIndex
CREATE INDEX "report_card_lines_reportCardId_idx" ON "report_card_lines"("reportCardId");

-- CreateIndex
CREATE INDEX "guardians_schoolId_idx" ON "guardians"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_schoolId_userId_key" ON "guardians"("schoolId", "userId");

-- CreateIndex
CREATE INDEX "guardian_students_schoolId_studentId_idx" ON "guardian_students"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_students_guardianId_studentId_key" ON "guardian_students"("guardianId", "studentId");

-- CreateIndex
CREATE INDEX "tasks_schoolId_assigneeId_status_idx" ON "tasks"("schoolId", "assigneeId", "status");

-- CreateIndex
CREATE INDEX "tasks_schoolId_status_dueAt_idx" ON "tasks"("schoolId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "tasks_schoolId_subjectType_subjectId_idx" ON "tasks"("schoolId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "task_comments_taskId_createdAt_idx" ON "task_comments"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "task_events_taskId_createdAt_idx" ON "task_events"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "task_watchers_membershipId_idx" ON "task_watchers"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "task_watchers_taskId_membershipId_key" ON "task_watchers"("taskId", "membershipId");

-- CreateIndex
CREATE INDEX "notifications_membershipId_readAt_createdAt_idx" ON "notifications"("membershipId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_schoolId_createdAt_idx" ON "notifications"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "forums_schoolId_audience_idx" ON "forums"("schoolId", "audience");

-- CreateIndex
CREATE UNIQUE INDEX "forums_schoolId_slug_key" ON "forums"("schoolId", "slug");

-- CreateIndex
CREATE INDEX "forum_categories_schoolId_idx" ON "forum_categories"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "forum_categories_forumId_slug_key" ON "forum_categories"("forumId", "slug");

-- CreateIndex
CREATE INDEX "threads_schoolId_forumId_status_idx" ON "threads"("schoolId", "forumId", "status");

-- CreateIndex
CREATE INDEX "threads_forumId_isPinned_lastPostAt_idx" ON "threads"("forumId", "isPinned", "lastPostAt");

-- CreateIndex
CREATE INDEX "posts_threadId_createdAt_idx" ON "posts"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "posts_schoolId_authorId_createdAt_idx" ON "posts"("schoolId", "authorId", "createdAt");

-- CreateIndex
CREATE INDEX "post_reactions_schoolId_idx" ON "post_reactions"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "post_reactions_postId_membershipId_key" ON "post_reactions"("postId", "membershipId");

-- CreateIndex
CREATE INDEX "post_reports_schoolId_status_idx" ON "post_reports"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "post_reports_postId_reporterId_key" ON "post_reports"("postId", "reporterId");

-- CreateIndex
CREATE INDEX "library_resources_schoolId_isArchived_publishedAt_idx" ON "library_resources"("schoolId", "isArchived", "publishedAt");

-- CreateIndex
CREATE INDEX "library_resources_schoolId_kind_idx" ON "library_resources"("schoolId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "resource_collections_schoolId_slug_key" ON "resource_collections"("schoolId", "slug");

-- CreateIndex
CREATE INDEX "resource_collection_items_schoolId_idx" ON "resource_collection_items"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "resource_collection_items_collectionId_resourceId_key" ON "resource_collection_items"("collectionId", "resourceId");

-- CreateIndex
CREATE INDEX "resource_views_resourceId_viewedAt_idx" ON "resource_views"("resourceId", "viewedAt");

-- CreateIndex
CREATE INDEX "resource_views_schoolId_membershipId_viewedAt_idx" ON "resource_views"("schoolId", "membershipId", "viewedAt");

-- CreateIndex
CREATE INDEX "rate_limit_hits_action_identifier_createdAt_idx" ON "rate_limit_hits"("action", "identifier", "createdAt");

-- CreateIndex
CREATE INDEX "rate_limit_hits_action_address_createdAt_idx" ON "rate_limit_hits"("action", "address", "createdAt");

-- CreateIndex
CREATE INDEX "rate_limit_hits_createdAt_idx" ON "rate_limit_hits"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_schoolId_key" ON "subscriptions"("schoolId");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_invoices_reference_key" ON "subscription_invoices"("reference");

-- CreateIndex
CREATE INDEX "subscription_invoices_schoolId_status_idx" ON "subscription_invoices"("schoolId", "status");

-- CreateIndex
CREATE INDEX "subscription_invoices_status_dueAt_idx" ON "subscription_invoices"("status", "dueAt");

-- CreateIndex
CREATE INDEX "subscription_invoice_lines_invoiceId_idx" ON "subscription_invoice_lines"("invoiceId");

