-- CreateTable
CREATE TABLE "meeting_contexts" (
    "id" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "savedFileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "detectedLanguage" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "summaryInDetectedLanguage" TEXT NOT NULL,
    "summaryInEnglish" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meeting_contexts_createdAt_idx" ON "meeting_contexts"("createdAt");
