import Foundation
import Security

let original = Data("sk-synthetic-verification-only-A".utf8)
let wrong = Data("sk-synthetic-verification-only-B".utf8)
precondition(original.count == wrong.count)
var cases = 0
for storeStatus in [errSecSuccess, errSecItemNotFound, errSecAuthFailed] {
    for addStatus in [errSecSuccess, errSecAuthFailed] {
        for readStatus in [errSecSuccess, errSecAuthFailed] {
            for stored in [original, wrong, Data(), nil] as [Data?] {
                var writes = 0, reads = 0
                var ops = KeychainOperations()
                ops.update = { _, attributes in
                    precondition((attributes as NSDictionary)[kSecValueData] as? Data == original)
                    return storeStatus
                }
                ops.add = { attributes in
                    writes += 1
                    precondition((attributes as NSDictionary)[kSecValueData] as? Data == original)
                    return addStatus
                }
                ops.read = { _ in reads += 1; return (readStatus, stored) }
                let validStore = storeStatus == errSecSuccess || (storeStatus == errSecItemNotFound && addStatus == errSecSuccess)
                let expected = validStore && readStatus == errSecSuccess && stored == original
                precondition(storeAndVerify(original, account: "synthetic", service: "test", operations: ops) == expected)
                precondition(writes == (storeStatus == errSecItemNotFound ? 1 : 0))
                precondition(reads == (validStore ? 1 : 0))
                cases += 1
            }
        }
    }
}
print("Keychain store/readback matrix: \(cases) passed; no values printed")
