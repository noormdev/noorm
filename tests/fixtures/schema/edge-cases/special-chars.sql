-- Edge Case: Special characters in identifiers
-- Tests database handling of quoted identifiers with spaces and special chars
-- Note: These require quoted identifiers in most databases

-- Table with spaces in name (requires quoting)
CREATE TABLE "User Profiles" (
    id INTEGER PRIMARY KEY,
    "First Name" VARCHAR(100),
    "Last Name" VARCHAR(100),
    "E-Mail Address" VARCHAR(255),
    "Phone Number" VARCHAR(20)
);

-- Table with special characters (requires quoting)
CREATE TABLE "Product-Categories" (
    id INTEGER PRIMARY KEY,
    "Category-Name" VARCHAR(100),
    "Parent-ID" INTEGER,
    "Sort-Order" INTEGER DEFAULT 0
);

-- Index with special characters
CREATE INDEX "idx-product-categories-parent"
ON "Product-Categories"("Parent-ID");
