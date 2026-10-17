-- Extra warranty items (name + months) entered with the scooter and printed on its warranty card. Additive.

-- AlterTable
ALTER TABLE "InventoryUnit" ADD COLUMN     "warrantyExtras" JSONB NOT NULL DEFAULT '[]';

