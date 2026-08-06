import UIKit
import Capacitor

class ViewController: CAPBridgeViewController, UIScrollViewDelegate {
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            guard let scrollView = self.webView?.scrollView else { return }
            scrollView.delegate = self
            scrollView.minimumZoomScale = 1.0
            scrollView.maximumZoomScale = 5.0
            scrollView.bouncesZoom = false
            scrollView.pinchGestureRecognizer?.isEnabled = true
        }
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? {
        return self.webView
    }
}
