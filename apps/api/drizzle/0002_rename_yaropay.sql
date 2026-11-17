ALTER TABLE "settings" ALTER COLUMN "platform_name" SET DEFAULT 'YaroPay';--> statement-breakpoint
-- Installs created under the project's first name keep their untouched default platform name in step.
UPDATE "settings" SET "platform_name" = 'YaroPay' WHERE "platform_name" = 'Payroute';
