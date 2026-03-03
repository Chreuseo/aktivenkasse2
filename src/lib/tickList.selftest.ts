import { calcRowAmountCents, centsToAmountString, parsePriceToCents } from "./tickList";

function assertEq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

(function main() {
  assertEq(parsePriceToCents("1"), 100, "price 1");
  assertEq(parsePriceToCents("1.99"), 199, "price 1.99");
  assertEq(parsePriceToCents("1,50"), 150, "price comma");
  assertEq(parsePriceToCents(""), null, "price empty");
  assertEq(parsePriceToCents("0"), null, "price 0 invalid");

  const cents = calcRowAmountCents(
    { qtyByItemId: { a: 2, b: 3 } },
    [
      { id: "a", price: "1.50" },
      { id: "b", price: "0.20" },
    ]
  );
  assertEq(cents, 2 * 150 + 3 * 20, "calc amount");
  assertEq(centsToAmountString(cents), "3.60", "format");

  // missing qty => 0
  assertEq(calcRowAmountCents({ qtyByItemId: {} }, [{ id: "a", price: "1" }]), 0, "missing qty");

  console.log("tickList.selftest OK");
})();

