let currentQuestion = null;
let allQuestions = [];
let currentIndex = 0;

// Tải toàn bộ câu hỏi từ file JSON khi trang web load (chỉ tải 1 lần)
document.addEventListener("DOMContentLoaded", loadQuestions);

function loadQuestions() {
  fetch("questions.json")
    .then((response) => {
      if (!response.ok) {
        throw new Error("Không thể tải file questions.json");
      }
      return response.json();
    })
    .then((questions) => {
      allQuestions = questions;
      currentIndex = 0;
      showQuestion();
    })
    .catch((error) => {
      console.error(error);
      document.getElementById("question").innerText = "Lỗi khi tải câu hỏi!";
    });
}

function showQuestion() {
  // Reset giao diện
  document.getElementById("result").innerText = "";
  document.getElementById("next-btn").style.display = "none";
  const explanationEl = document.getElementById("explanation");
  explanationEl.style.display = "none"; // ẩn khung giải thích
  explanationEl.innerText = ""; // xoá nội dung giải thích cũ

  currentQuestion = allQuestions[currentIndex];
  displayQuestion(currentQuestion);
}

function displayQuestion(q) {
  document.getElementById("question").innerText = q.question;
  const optionsContainer = document.getElementById("options");
  optionsContainer.innerHTML = ""; // Xóa các đáp án cũ

  q.options.forEach((optionText, index) => {
    const button = document.createElement("button");
    button.innerText = optionText;
    button.classList.add("option-btn");

    // Bắt sự kiện người dùng chọn đáp án
    button.onclick = () => checkAnswer(index, button);

    optionsContainer.appendChild(button);
  });
}

function checkAnswer(selectedIndex, selectedButton) {
  const buttons = document.querySelectorAll(".option-btn");

  // Vô hiệu hóa tất cả các nút sau khi đã chọn
  buttons.forEach((btn) => (btn.disabled = true));

  if (selectedIndex === currentQuestion.answer) {
    selectedButton.classList.add("correct");
    document.getElementById("result").innerText = "🎉 Chính xác!";
    document.getElementById("result").style.color = "#28a745";
  } else {
    selectedButton.classList.add("wrong");
    // Đánh dấu luôn đáp án đúng để người dùng biết
    buttons[currentQuestion.answer].classList.add("correct");
    document.getElementById("result").innerText = "❌ Sai rồi!";
    document.getElementById("result").style.color = "#dc3545";
    // Hiển thị đoạn văn bản giải thích khi trả lời sai
    if (currentQuestion.explanation) {
      const explanationEl = document.getElementById("explanation");
      explanationEl.innerText = "💡 " + currentQuestion.explanation;
      explanationEl.style.display = "block";
    }
  }

  // Nếu đây là câu cuối cùng, đổi nút thành "Hoàn thành" thay vì "Câu tiếp theo"
  const nextBtn = document.getElementById("next-btn");
  if (currentIndex >= allQuestions.length - 1) {
    nextBtn.innerText = "Hoàn thành ✔";
  } else {
    nextBtn.innerText = "Câu hỏi tiếp theo ➔";
  }
  nextBtn.style.display = "block";
}

// Bắt sự kiện khi bấm nút chuyển câu hỏi / hoàn thành
document.getElementById("next-btn").addEventListener("click", function () {
  currentIndex++;

  if (currentIndex >= allQuestions.length) {
    // Đã hết câu hỏi -> dừng lại, hiện thông báo hoàn thành
    document.querySelector(".quiz-container").innerHTML =
      "<h2>🎉🤩 Hết câu hỏi mất rồi!</h2>";
    return;
  }

  showQuestion();
});
