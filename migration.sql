-- CreateTable
CREATE TABLE `Account` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `balance` DECIMAL(65, 30) NOT NULL,
    `interest` BOOLEAN NOT NULL,
    `type` ENUM('user', 'bank', 'clearing_account') NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `first_name` VARCHAR(191) NOT NULL,
    `last_name` VARCHAR(191) NOT NULL,
    `mail` VARCHAR(191) NOT NULL,
    `keycloak_id` VARCHAR(191) NOT NULL,
    `street` VARCHAR(191) NULL,
    `postal_code` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `hv_mitglied` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `accountId` INTEGER NOT NULL,
    `sepa_mandate` BOOLEAN NOT NULL DEFAULT false,
    `sepa_mandate_date` DATETIME(3) NULL,
    `sepa_mandate_reference` VARCHAR(191) NULL,
    `sepa_iban` VARCHAR(191) NULL,
    `sepa_bic` VARCHAR(191) NULL,

    UNIQUE INDEX `User_mail_key`(`mail`),
    UNIQUE INDEX `User_keycloak_id_key`(`keycloak_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Role` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NULL,
    `keycloak_id` VARCHAR(191) NULL,
    `userId` INTEGER NULL,
    `overview` ENUM('none', 'read_own', 'read_all', 'write_all') NOT NULL DEFAULT 'none',
    `mails` ENUM('none', 'read_own', 'read_all', 'write_all') NOT NULL DEFAULT 'none',
    `budget_plan` ENUM('none', 'read_own', 'read_all', 'write_all') NOT NULL DEFAULT 'none',
    `userAuth` ENUM('none', 'read_own', 'read_all', 'write_all') NOT NULL DEFAULT 'none',
    `clearing_accounts` ENUM('none', 'read_own', 'read_all', 'write_all') NOT NULL DEFAULT 'none',
    `bank_accounts` ENUM('none', 'read_own', 'read_all', 'write_all') NOT NULL DEFAULT 'none',
    `transactions` ENUM('none', 'read_own', 'read_all', 'write_all') NOT NULL DEFAULT 'none',
    `advances` ENUM('none', 'read_own', 'read_all', 'write_all') NOT NULL DEFAULT 'none',

    UNIQUE INDEX `Role_name_key`(`name`),
    UNIQUE INDEX `Role_keycloak_id_key`(`keycloak_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BankAccount` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `owner` VARCHAR(191) NOT NULL DEFAULT '',
    `bank` VARCHAR(191) NOT NULL,
    `iban` VARCHAR(191) NOT NULL,
    `bic` VARCHAR(191) NULL,
    `accountId` INTEGER NOT NULL,
    `payment_method` BOOLEAN NOT NULL DEFAULT false,
    `create_girocode` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `BankAccount_iban_key`(`iban`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClearingAccount` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `responsibleId` INTEGER NULL,
    `accountId` INTEGER NOT NULL,
    `reimbursementEligible` BOOLEAN NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClearingAccountMember` (
    `clearingAccountId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,

    PRIMARY KEY (`clearingAccountId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BudgetPlan` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `state` ENUM('draft', 'active', 'closed') NOT NULL DEFAULT 'draft',
    `firstCostCenter` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CostCenter` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `earnings_expected` DECIMAL(65, 30) NOT NULL,
    `costs_expected` DECIMAL(65, 30) NOT NULL,
    `earnings_actual` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `costs_actual` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `budget_planId` INTEGER NOT NULL,
    `is_donation` BOOLEAN NOT NULL DEFAULT false,
    `nextCostCenter` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
    `downloadedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Donation_transactionId_key`(`transactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Transaction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `amount` DECIMAL(65, 30) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `date_valued` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `description` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NULL,
    `processed` BOOLEAN NOT NULL DEFAULT true,
    `accountId` INTEGER NOT NULL,
    `createdById` INTEGER NOT NULL,
    `accountValueAfter` DECIMAL(65, 30) NOT NULL,
    `counter_transactionId` INTEGER NULL,
    `costCenterId` INTEGER NULL,
    `attachmentId` INTEGER NULL,
    `transactionBulkId` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TransactionBulk` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `date_valued` DATETIME(3) NULL,
    `transactionId` INTEGER NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(191) NULL,
    `accountId` INTEGER NOT NULL,
    `attachmentId` INTEGER NULL,
    `type` ENUM('collection', 'deposit', 'payout') NOT NULL,

    UNIQUE INDEX `TransactionBulk_transactionId_key`(`transactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Advances` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `amount` DECIMAL(65, 30) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `date_advance` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `description` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `clearingAccountId` INTEGER NULL,
    `transactionId` INTEGER NULL,
    `is_donation` BOOLEAN NOT NULL DEFAULT false,
    `donationType` ENUM('financial', 'material', 'waive_fees') NULL,
    `donationId` INTEGER NULL,
    `reviewerId` INTEGER NULL,
    `state` ENUM('open', 'cancelled', 'accepted', 'rejected') NOT NULL DEFAULT 'open',
    `reason` VARCHAR(191) NULL,
    `decidedAt` DATETIME(3) NULL,
    `attachmentId` INTEGER NULL,
    `paymentRequest` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Attachment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `data` LONGBLOB NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Mail` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `subject` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` INTEGER NULL,
    `addressedTo` VARCHAR(191) NOT NULL,
    `attachment` VARCHAR(191) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Dues` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `amount` DECIMAL(65, 30) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueDate` DATETIME(3) NOT NULL,
    `paid` BOOLEAN NOT NULL DEFAULT false,
    `paidAt` DATETIME(3) NULL,
    `interestBilled` BOOLEAN NOT NULL DEFAULT false,
    `accountId` INTEGER NOT NULL,
    `transactionId` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Role` ADD CONSTRAINT `Role_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BankAccount` ADD CONSTRAINT `BankAccount_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClearingAccount` ADD CONSTRAINT `ClearingAccount_responsibleId_fkey` FOREIGN KEY (`responsibleId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClearingAccount` ADD CONSTRAINT `ClearingAccount_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClearingAccountMember` ADD CONSTRAINT `ClearingAccountMember_clearingAccountId_fkey` FOREIGN KEY (`clearingAccountId`) REFERENCES `ClearingAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClearingAccountMember` ADD CONSTRAINT `ClearingAccountMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BudgetPlan` ADD CONSTRAINT `BudgetPlan_firstCostCenter_fkey` FOREIGN KEY (`firstCostCenter`) REFERENCES `CostCenter`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CostCenter` ADD CONSTRAINT `CostCenter_budget_planId_fkey` FOREIGN KEY (`budget_planId`) REFERENCES `BudgetPlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CostCenter` ADD CONSTRAINT `CostCenter_nextCostCenter_fkey` FOREIGN KEY (`nextCostCenter`) REFERENCES `CostCenter`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Allowance` ADD CONSTRAINT `Allowance_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Donation` ADD CONSTRAINT `Donation_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `Transaction`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Donation` ADD CONSTRAINT `Donation_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Donation` ADD CONSTRAINT `Donation_processorId_fkey` FOREIGN KEY (`processorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_counter_transactionId_fkey` FOREIGN KEY (`counter_transactionId`) REFERENCES `Transaction`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_costCenterId_fkey` FOREIGN KEY (`costCenterId`) REFERENCES `CostCenter`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_attachmentId_fkey` FOREIGN KEY (`attachmentId`) REFERENCES `Attachment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_transactionBulkId_fkey` FOREIGN KEY (`transactionBulkId`) REFERENCES `TransactionBulk`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransactionBulk` ADD CONSTRAINT `TransactionBulk_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `Transaction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransactionBulk` ADD CONSTRAINT `TransactionBulk_attachmentId_fkey` FOREIGN KEY (`attachmentId`) REFERENCES `Attachment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TransactionBulk` ADD CONSTRAINT `TransactionBulk_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Advances` ADD CONSTRAINT `Advances_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Advances` ADD CONSTRAINT `Advances_clearingAccountId_fkey` FOREIGN KEY (`clearingAccountId`) REFERENCES `ClearingAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Advances` ADD CONSTRAINT `Advances_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `Transaction`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Advances` ADD CONSTRAINT `Advances_donationId_fkey` FOREIGN KEY (`donationId`) REFERENCES `Donation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Advances` ADD CONSTRAINT `Advances_reviewerId_fkey` FOREIGN KEY (`reviewerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Advances` ADD CONSTRAINT `Advances_attachmentId_fkey` FOREIGN KEY (`attachmentId`) REFERENCES `Attachment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mail` ADD CONSTRAINT `Mail_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dues` ADD CONSTRAINT `Dues_transactionId_fkey` FOREIGN KEY (`transactionId`) REFERENCES `Transaction`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Dues` ADD CONSTRAINT `Dues_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

