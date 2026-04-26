import SwiftUI
import FamilyControls

/// Wraps FamilyActivityPicker in a NavigationView with Done / Cancel toolbar buttons.
@available(iOS 16.0, *)
struct AppPickerView: View {
  @State private var selection: FamilyActivitySelection

  private let onDone:   (FamilyActivitySelection) -> Void
  private let onCancel: () -> Void

  init(
    initialSelection: FamilyActivitySelection,
    onDone:   @escaping (FamilyActivitySelection) -> Void,
    onCancel: @escaping () -> Void
  ) {
    _selection = State(initialValue: initialSelection)
    self.onDone   = onDone
    self.onCancel = onCancel
  }

  var body: some View {
    NavigationStack {
      FamilyActivityPicker(selection: $selection)
        .navigationTitle("Choose Loop Apps")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .navigationBarLeading) {
            Button("Cancel", action: onCancel)
          }
          ToolbarItem(placement: .navigationBarTrailing) {
            Button("Done") { onDone(selection) }
              .fontWeight(.semibold)
          }
        }
    }
    .preferredColorScheme(.dark)
  }
}
