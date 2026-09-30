// Find text lines on a still image with Apple's Vision framework and print them as JSON.
//   swift benchmarks/gpu/find_text.swift <image> [<image> ...]
// Boxes are percentages of the image, top-left origin, matching slides.json.
import Foundation
import Vision
import AppKit

struct Line: Codable { let text: String; let confidence: Float; let x: Double; let y: Double; let width: Double; let height: Double }
struct Result: Codable { let image: String; let lines: [Line] }

var results: [Result] = []
for path in CommandLine.arguments.dropFirst() {
    guard let image = NSImage(contentsOfFile: path),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        FileHandle.standardError.write("Cannot read \(path)\n".data(using: .utf8)!)
        exit(1)
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: cg).perform([request])
    let lines = (request.results ?? []).compactMap { observation -> Line? in
        guard let best = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox  // Normalised, bottom-left origin.
        func pct(_ v: Double) -> Double { (v * 1000).rounded() / 10 }
        return Line(text: best.string, confidence: best.confidence, x: pct(box.minX), y: pct(1 - box.maxY),
                    width: pct(box.width), height: pct(box.height))
    }
    results.append(Result(image: path, lines: lines))
}
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
print(String(data: try encoder.encode(results), encoding: .utf8)!)
