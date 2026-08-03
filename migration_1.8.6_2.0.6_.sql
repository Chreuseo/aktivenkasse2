-- AlterTable
ALTER TABLE `User` ADD COLUMN `city` VARCHAR(191) NULL,
    ADD COLUMN `hv_mitglied` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `postal_code` VARCHAR(191) NULL,
    ADD COLUMN `sepa_bic` VARCHAR(191) NULL,
    ADD COLUMN `sepa_iban` VARCHAR(191) NULL,
    ADD COLUMN `sepa_mandate` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `sepa_mandate_date` DATETIME(3) NULL,
    ADD COLUMN `sepa_mandate_reference` VARCHAR(191) NULL,
    ADD COLUMN `status` VARCHAR(191) NULL,
    ADD COLUMN `street` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `CostCenter` ADD COLUMN `is_donation` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Transaction` ADD COLUMN `processed` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `Advances` ADD COLUMN `donationId` INTEGER NULL,
    ADD COLUMN `donationType` ENUM('financial', 'material', 'waive_fees') NULL,
    ADD COLUMN `is_donation` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `Allowance` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `returnDate` DATETIME(3) NULL,
    `description` VARCHAR(191) NULL,
    `amount` DECIMAL(65, 30) NOT NULL,
    `accountId` INTEGER NOT NULL,
    `withheld` DECIMAL(65, 30) NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Donation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `description` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(65, 30) NOT NULL,
    `type` ENUM('financial', 'material', 'waive_fees') NOT NULL,
    `transactionId` INTEGER NULL,
    `userId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processorId` INTEGER NOT NULL,

    UNIQUE INDEX `Donation_transactionId_key`(`transactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Allowance` ADD CONSTRAINT `Allowance_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Donation` ADD CONSTRAINT `Donation_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `Transaction`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Donation` ADD CONSTRAINT `Donation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Donation` ADD CONSTRAINT `Donation_processorId_fkey` FOREIGN KEY (`processorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Advances` ADD CONSTRAINT `Advances_donationId_fkey` FOREIGN KEY (`donationId`) REFERENCES `Donation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

