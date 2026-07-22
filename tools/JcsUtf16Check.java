import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class JcsUtf16Check {
  private static final String EXPECTED_HASH =
      "272ee817325ef78e70211cb998933413262f376bb006ba1b6fa30e2cb330bce9";

  public static void main(String[] args) throws Exception {
    String specVersion = readSpecVersion();
    String astral = "\uD800\uDC00"; // U+10000
    String bmp = "\uE000";
    Map<String, Object> artifacts = new LinkedHashMap<>();
    artifacts.put(bmp, Map.of("type", "pipeline", "steps", List.of("shared.rule")));
    artifacts.put(astral, Map.of("type", "pipeline", "steps", List.of("shared.rule")));
    artifacts.put("shared.rule", Map.of(
        "type", "rule",
        "operator", "not_empty",
        "field", "a",
        "issue", Map.of("level", "ERROR", "code", "D28.2", "message", "failed")));

    Map<String, Object> snapshotWithoutHash = new LinkedHashMap<>();
    snapshotWithoutHash.put("format", "jsonspecs-snapshot");
    snapshotWithoutHash.put("formatVersion", 2);
    snapshotWithoutHash.put("specVersion", specVersion);
    snapshotWithoutHash.put("exports", List.of(astral, bmp));
    snapshotWithoutHash.put("artifacts", artifacts);

    Map<String, Integer> orderProbe = new TreeMap<>();
    orderProbe.put(bmp, 2);
    orderProbe.put(astral, 1);

    if (!orderProbe.keySet().iterator().next().equals(astral)) {
      throw new AssertionError("Java string order is not unsigned UTF-16 order");
    }

    byte[] digest = MessageDigest.getInstance("SHA-256")
        .digest(jcs(snapshotWithoutHash).getBytes(StandardCharsets.UTF_8));
    String actual = HexFormat.of().formatHex(digest);
    if (!EXPECTED_HASH.equals(actual)) {
      throw new AssertionError("JCS UTF-16 vector hash mismatch: " + actual);
    }
    System.out.println("OK: Java JCS UTF-16 vector " + actual + " (" + specVersion + ")");
  }

  private static String readSpecVersion() throws Exception {
    String spec = Files.readString(Path.of("SPEC.md"), StandardCharsets.UTF_8);
    Matcher matcher = Pattern.compile("^\\*\\*Version:\\*\\*\\s+([^\\s]+)\\s*$", Pattern.MULTILINE)
        .matcher(spec);
    if (!matcher.find()) throw new AssertionError("SPEC.md has no canonical Version line");
    String version = matcher.group(1);
    if (matcher.find()) throw new AssertionError("SPEC.md has more than one canonical Version line");
    return version;
  }

  private static String jcs(Object value) {
    if (value == null) return "null";
    if (value instanceof String string) return quote(string);
    if (value instanceof Boolean || value instanceof Number) return value.toString();
    if (value instanceof List<?> list) {
      return "[" + list.stream().map(JcsUtf16Check::jcs).reduce((a, b) -> a + "," + b).orElse("") + "]";
    }
    if (value instanceof Map<?, ?> map) {
      Map<String, Object> sorted = new TreeMap<>();
      for (var entry : map.entrySet()) sorted.put((String) entry.getKey(), entry.getValue());
      StringBuilder out = new StringBuilder("{");
      boolean first = true;
      for (var entry : sorted.entrySet()) {
        if (!first) out.append(',');
        out.append(quote(entry.getKey())).append(':').append(jcs(entry.getValue()));
        first = false;
      }
      return out.append('}').toString();
    }
    throw new IllegalArgumentException("unsupported JCS value: " + value.getClass());
  }

  private static String quote(String value) {
    StringBuilder out = new StringBuilder("\"");
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      switch (c) {
        case '\"' -> out.append("\\\"");
        case '\\' -> out.append("\\\\");
        case '\b' -> out.append("\\b");
        case '\f' -> out.append("\\f");
        case '\n' -> out.append("\\n");
        case '\r' -> out.append("\\r");
        case '\t' -> out.append("\\t");
        default -> {
          if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
          else out.append(c);
        }
      }
    }
    return out.append('\"').toString();
  }
}
