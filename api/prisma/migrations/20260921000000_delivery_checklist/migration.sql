-- AlterTable
ALTER TABLE "DeliveryChecklist" ADD COLUMN     "accessoriesFitted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "charged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "insurance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "invoice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rcBook" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "warrantyCard" BOOLEAN NOT NULL DEFAULT false;

