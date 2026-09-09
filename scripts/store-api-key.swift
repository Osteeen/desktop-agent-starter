import Foundation
import Security

struct KeychainOperations {
    var update: (CFDictionary, CFDictionary) -> OSStatus = SecItemUpdate
    var add: (CFDictionary) -> OSStatus = { SecItemAdd($0, nil) }
    var read: (CFDictionary) -> (OSStatus, Data?) = { query in
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query, &result)
        return (status, result as? Data)
    }
}

func storeAndVerify(_ original: Data, account: String, service: String,
                    operations: KeychainOperations = KeychainOperations()) -> Bool {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrAccount as String: account,
        kSecAttrService as String: service,
    ]
    let attributes = [kSecValueData as String: original]
    var status = operations.update(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
        status = operations.add(query.merging(attributes) { _, new in new } as CFDictionary)
    }
    guard status == errSecSuccess else { return false }
    var readQuery = query
    readQuery[kSecReturnData as String] = true
    readQuery[kSecMatchLimit as String] = kSecMatchLimitOne
    let (readStatus, stored) = operations.read(readQuery as CFDictionary)
    return readStatus == errSecSuccess && stored == original
}

#if !KEYCHAIN_HELPER_TEST
// Only account and service are arguments. The secret is consumed once from stdin.
@main
struct StoreAPIKey {
    static func main() {
        guard CommandLine.arguments.count == 3,
              let key = readLine(), key.hasPrefix("sk-"), key.count > 3 else {
            exit(1)
        }
        exit(storeAndVerify(Data(key.utf8), account: CommandLine.arguments[1],
                            service: CommandLine.arguments[2]) ? 0 : 1)
    }
}
#endif
