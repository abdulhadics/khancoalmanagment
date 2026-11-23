BEGIN;

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('CUSTOMER_OVERDUE', 'SUPPLIER_OVERDUE', 'DELIVERY_PENDING', 'GENERAL');

-- CreateEnum
CREATE TYPE "expense_category" AS ENUM ('RENT', 'TRANSPORTATION', 'LABOR', 'SALARY', 'UTILITIES', 'FOOD_REFRESHMENTS', 'MAINTENANCE', 'OTHER');

-- CreateTable
CREATE TABLE "notifications" (
    "id" BIGSERIAL NOT NULL,
    "type" "notification_type" NOT NULL,
    "title" VARCHAR(250) NOT NULL,
    "message" VARCHAR(1500) NOT NULL,
    "customer_id" UUID,
    "supplier_id" UUID,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_dismissed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_date" DATE NOT NULL,
    "category" "expense_category" NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" VARCHAR(1500),
    "created_by_id" UUID NOT NULL,
    "voided_by_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "ordered_weight" DECIMAL(12,3) NOT NULL,
    "delivered_weight" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "notes" VARCHAR(1500),
    "is_complete" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_pickups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_record_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "weight" DECIMAL(12,3) NOT NULL,
    "vehicle_no" VARCHAR(40),
    "notes" VARCHAR(1500),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_pickups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_is_read_is_dismissed_created_at_idx" ON "notifications"("is_read", "is_dismissed", "created_at");
CREATE INDEX "notifications_customer_id_idx" ON "notifications"("customer_id");
CREATE INDEX "notifications_supplier_id_idx" ON "notifications"("supplier_id");

-- CreateIndex
CREATE INDEX "expenses_business_date_id_idx" ON "expenses"("business_date", "id");
CREATE INDEX "expenses_category_business_date_idx" ON "expenses"("category", "business_date");

-- CreateIndex
CREATE INDEX "delivery_records_customer_id_is_complete_idx" ON "delivery_records"("customer_id", "is_complete");
CREATE INDEX "delivery_records_business_date_idx" ON "delivery_records"("business_date");

-- CreateIndex
CREATE INDEX "delivery_pickups_delivery_record_id_idx" ON "delivery_pickups"("delivery_record_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_records" ADD CONSTRAINT "delivery_records_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_records" ADD CONSTRAINT "delivery_records_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_pickups" ADD CONSTRAINT "delivery_pickups_delivery_record_id_fkey" FOREIGN KEY ("delivery_record_id") REFERENCES "delivery_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_pickups" ADD CONSTRAINT "delivery_pickups_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
